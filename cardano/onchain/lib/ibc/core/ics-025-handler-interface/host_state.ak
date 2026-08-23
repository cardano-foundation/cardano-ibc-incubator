use aiken/builtin
use aiken/cbor
// IBC Host State - Single Token Thread (STT) Architecture
//
// This module defines the canonical IBC host state maintained in a single UTXO
// identified by a unique NFT (IBC Host State Token).
//
// Architecture:
// - Exactly ONE HostState UTXO exists at any time (enforced by NFT uniqueness)
// - The UTXO datum contains the authoritative ibc_state_root and metadata
// - State updates MUST spend the old HostState UTXO and create a new one with:
//   * Same NFT (continuity)
//   * Updated ibc_state_root (new Merkle commitment)
//   * Incremented version (monotonicity)
//
// This design eliminates state ambiguity and simplifies indexing/querying.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{
  Blake2b_224, Hash, Script, ScriptHash, VerificationKeyHash, blake2b_256,
}
use aiken/primitive/bytearray
use cardano/transaction.{OutputReference}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/reclamation

// Empty ICS-23 Merkle tree root (32 bytes of zeros)
pub const empty_ibc_state_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

/// Empty authenticated reference-script inventory chain.
pub const empty_reference_script_inventory_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const reference_script_inventory_domain = "ibc-reference-script-v1"

// IBC Host State NFT token name
pub const host_state_token_name = "ibc_host_state"

/// Bound ports are permanent protocol registrations, so their aggregate state
/// must have a ledger-safe upper bound. The deployment currently registers
/// three ports and can add up to this fixed protocol-wide maximum.
pub const max_bound_ports = 10

/// Hard protocol bound well above the current deployment inventory (~29),
/// preventing a signed count typo from creating an unrecoverable obligation.
pub const max_reference_script_inventory_count = 128

/// Retired module registrations move under a reserved NUL-prefixed key. Valid
/// ICS port identifiers can never start with NUL, so normal module lookups stop
/// finding them while cold rebuild retains the original registration value and
/// can strip the marker to reconstruct the immutable `ports/{port}` leaf.
pub fn retired_port_marker(port_id: ByteArray) -> ByteArray {
  bytearray.concat(#"00", port_id)
}

pub fn is_retired_port_marker(key: ByteArray) -> Bool {
  if bytearray.length(key) == 0 {
    False
  } else {
    and {
      bytearray.at(key, 0) == 0,
      port_keys.is_valid_port_id(bytearray.drop(key, 1)),
    }
  }
}

pub fn has_only_retired_ports(
  registrations: Pairs<ByteArray, ModuleRegistration>,
) -> Bool {
  list.all(registrations, fn(pair) { is_retired_port_marker(pair.1st) })
}

/// Order byte-string map keys for `pairs.insert_by_ascending_key` using the
/// order required by canonical CBOR.
///
/// Canonical CBOR sorts map keys by the length of their encoded form before
/// comparing the encoded bytes. Since both keys are byte strings, comparing
/// their payload lengths first and their bytes second produces that same order.
/// Equal keys return `Greater` because `validate_bind_port` rejects duplicates
/// and the insertion helper performs its own equality check.
/// This branch-minimal specialization protects the near-limit HostState reference-script budget.
fn compare_port_keys_for_insertion(
  left: ByteArray,
  right: ByteArray,
) -> Ordering {
  if builtin.less_than_bytearray(
    bytearray.push(left, bytearray.length(left)),
    bytearray.push(right, bytearray.length(right)),
  ) {
    Less
  } else {
    Greater
  }
}

/// ShutdownState controls whether the bridge accepts new user-facing work.
///
/// `Active` is the normal operating mode. `ShuttingDown` is entered by the
/// trusted deployment key and lets users drain/refund existing state before
/// protocol-owned min-ADA can be reclaimed.
pub type ShutdownState {
  Active
  ShuttingDown { initiated_at: Int, grace_period_end: Int }
  Sealed { sealed_at: Int, proof_window_end: Int }
}

/// The immutable authority registered for a bound IBC port.
///
/// Callback validators use this record to distinguish the real application
/// root from an arbitrary UTxO that happens to carry a derived port token.
pub type ModuleRegistration {
  module_script_hash: Hash<Blake2b_224, Script>,
  port_token: AuthToken,
  module_token: AuthToken,
}

/// Immutable identity committed for each deployed reference-script UTxO.
pub type ReferenceScriptIdentity {
  output_reference: OutputReference,
  reference_script_hash: ScriptHash,
}

/// Precommitted complete inventory and the last globally ordered outref already
/// folded on chain. Retained after finalization for audit and recovery.
pub type ReferenceScriptRegistration {
  target_count: Int,
  target_root: ByteArray,
  last_out_ref: OutputReference,
}

fn compare_output_references(
  left_ref: OutputReference,
  right_ref: OutputReference,
) -> Ordering {
  if left_ref.transaction_id == right_ref.transaction_id {
    if left_ref.output_index < right_ref.output_index {
      Less
    } else if left_ref.output_index == right_ref.output_index {
      Equal
    } else {
      Greater
    }
  } else if builtin.less_than_bytearray(
    left_ref.transaction_id,
    right_ref.transaction_id,
  ) {
    Less
  } else {
    Greater
  }
}

fn compare_reference_script_identities(
  left: ReferenceScriptIdentity,
  right: ReferenceScriptIdentity,
) -> Ordering {
  compare_output_references(left.output_reference, right.output_reference)
}

fn reference_script_identities_are_canonical(
  identities: List<ReferenceScriptIdentity>,
) -> Bool {
  when identities is {
    [] | [_] -> True
    [first, second, ..rest] -> and {
        compare_reference_script_identities(first, second) == Less,
        reference_script_identities_are_canonical([second, ..rest]),
      }
  }
}

fn is_host_reference_script(
  identity: ReferenceScriptIdentity,
  host_script_hash: ScriptHash,
) -> Bool {
  identity.reference_script_hash == host_script_hash
}

fn fold_reference_script_identities(
  root: ByteArray,
  identities: List<ReferenceScriptIdentity>,
) -> ByteArray {
  when identities is {
    [] -> root
    [identity, ..rest] -> {
      let next_root =
        reference_script_inventory_domain
          |> bytearray.concat(root)
          |> bytearray.concat(cbor.serialise(identity))
          |> blake2b_256
      fold_reference_script_identities(next_root, rest)
    }
  }
}

/// Fold an already-validated inventory sequence without reordering it. The
/// deployment uses this for the special Host-first inventory layout.
pub fn fold_reference_script_identities_in_order(
  root: ByteArray,
  identities: List<ReferenceScriptIdentity>,
) -> ByteArray {
  fold_reference_script_identities(root, identities)
}

/// Append identities in canonical outref order (transaction-id bytes ascending,
/// then output index ascending). Reclamation proves a suffix by supplying its
/// predecessor, independent of builder-provided list order.
pub fn append_reference_script_identities(
  root: ByteArray,
  identities: List<ReferenceScriptIdentity>,
) -> ByteArray {
  fold_reference_script_identities(
    root,
    list.sort(identities, compare_reference_script_identities),
  )
}

/// HostState represents the canonical IBC host state on Cardano
/// 
/// This state is maintained in a single UTXO identified by the IBC Host State NFT.
/// All IBC operations that mutate host state MUST update this UTXO.
pub type HostState {
  // Monotonic version counter - increments with each state update
  // Used to enforce forward-only state progression and prevent replay attacks
  version: Int,
  // ICS-23 Merkle root commitment over all IBC host state
  // This root covers: clients/, connections/, channels/, packets/, etc.
  // Computed off-chain by Gateway, verified via ICS-23 proofs on Cosmos
  ibc_state_root: ByteArray,
  // Sequence counters for IBC object creation
  next_client_sequence: Int,
  next_connection_sequence: Int,
  next_channel_sequence: Int,
  // Exact textual port ID -> immutable module authority and capability tokens.
  bound_port: Pairs<ByteArray, ModuleRegistration>,
  // Optional: Timestamp of last update (Unix epoch milliseconds)
  // Useful for debugging and monitoring
  last_update_time: Int,
  // Authenticated live-object counts. Creation increments exactly one count;
  // reclamation decrements it exactly once. Creation sequence counters above
  // remain historical totals and are never decremented or reused.
  live_client_count: Int,
  live_connection_count: Int,
  live_channel_count: Int,
}

/// HostStateDatum wraps the state with the NFT policy for verification
pub type HostStateDatum {
  state: HostState,
  // Policy ID of the IBC Host State NFT
  // This MUST match the NFT in the UTXO's value
  nft_policy: ByteArray,
  // Trusted deployer key hash allowed to enter shutdown and reclaim deployment
  // infrastructure after the grace period.
  deployer: VerificationKeyHash,
  // Lifecycle mode for controlled shutdown and eventual min-ADA reclaim.
  shutdown: ShutdownState,
  // Authenticated number of deployed reference-script UTxOs that remain.
  // `None` is unregistered, a negative count is batched registration in
  // progress, and a positive count is finalized. The atomic terminal burn
  // requires `Some(1)` for the sole remaining Host validator reference.
  live_reference_script_count: Option<Int>,
  // Domain-separated hash-chain commitment to the exact registered outrefs
  // and reference-script hashes. At terminal burn it commits exactly the
  // consumed Host validator reference against the empty predecessor root.
  reference_script_inventory_root: ByteArray,
  // Target commitment and resumable canonical-order cursor. `Some` is created
  // by the first registration batch and retained through final reclamation.
  reference_script_registration: Option<ReferenceScriptRegistration>,
}

pub fn is_active(shutdown: ShutdownState) -> Bool {
  when shutdown is {
    Active -> True
    ShuttingDown { .. } -> False
    Sealed { .. } -> False
  }
}

pub fn is_shutting_down(shutdown: ShutdownState) -> Bool {
  when shutdown is {
    Active -> False
    ShuttingDown { .. } -> True
    Sealed { .. } -> False
  }
}

pub fn is_sealed(shutdown: ShutdownState) -> Bool {
  when shutdown is {
    Sealed { .. } -> True
    Active | ShuttingDown { .. } -> False
  }
}

fn reference_registration_is_not_in_progress(datum: HostStateDatum) -> Bool {
  when datum.live_reference_script_count is {
    None -> True
    Some(count) -> count >= 0
  }
}

pub fn validate_reference_inventory_preserved(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    old |> reference_registration_is_not_in_progress,
    new.live_reference_script_count == old.live_reference_script_count,
    new.reference_script_inventory_root == old.reference_script_inventory_root,
    new.reference_script_registration == old.reference_script_registration,
  }
}

/// Validate initial HostState datum at genesis/deployment
/// 
/// Requirements:
/// - version starts at 0
/// - all sequences start at 0
/// - no bound ports
/// - ibc_state_root is empty tree root
/// - nft_policy matches the provided policy
pub fn is_initialized_valid(
  datum: HostStateDatum,
  expected_nft_policy: ByteArray,
) -> Bool {
  let HostStateDatum {
    state,
    nft_policy,
    shutdown,
    live_reference_script_count,
    reference_script_inventory_root,
    reference_script_registration,
    ..
  } = datum
  and {
    state.version == 0,
    state.next_client_sequence == 0,
    state.next_connection_sequence == 0,
    state.next_channel_sequence == 0,
    state.live_client_count == 0,
    state.live_connection_count == 0,
    state.live_channel_count == 0,
    state.bound_port == [],
    state.ibc_state_root == empty_ibc_state_root,
    shutdown == Active,
    live_reference_script_count == None,
    reference_script_inventory_root == empty_reference_script_inventory_root,
    reference_script_registration == None,
    nft_policy == expected_nft_policy,
  }
}

/// Validate monotonic version progression
/// 
/// The version MUST increment by exactly 1 with each state update.
/// This prevents:
/// - Replay attacks (old state cannot be re-applied)
/// - State rollback (cannot go backwards)
/// - Parallel updates (only one valid next state)
pub fn validate_version_increment(old: HostState, new: HostState) -> Bool {
  new.version == old.version + 1
}

/// Validate that no operation changed any live-object count.
pub fn validate_live_counts_unchanged(old: HostState, new: HostState) -> Bool {
  and {
    new.live_client_count == old.live_client_count,
    new.live_connection_count == old.live_connection_count,
    new.live_channel_count == old.live_channel_count,
  }
}

pub fn validate_live_client_count_increment(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_client_count >= 0,
    new.live_client_count == old.live_client_count + 1,
    new.live_connection_count == old.live_connection_count,
    new.live_channel_count == old.live_channel_count,
  }
}

pub fn validate_live_client_count_decrement(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_client_count > 0,
    new.live_client_count == old.live_client_count - 1,
    new.live_connection_count == old.live_connection_count,
    new.live_channel_count == old.live_channel_count,
  }
}

pub fn validate_live_connection_count_increment(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_connection_count >= 0,
    new.live_client_count == old.live_client_count,
    new.live_connection_count == old.live_connection_count + 1,
    new.live_channel_count == old.live_channel_count,
  }
}

pub fn validate_live_connection_count_decrement(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_connection_count > 0,
    new.live_client_count == old.live_client_count,
    new.live_connection_count == old.live_connection_count - 1,
    new.live_channel_count == old.live_channel_count,
  }
}

pub fn validate_live_channel_count_increment(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_channel_count >= 0,
    new.live_client_count == old.live_client_count,
    new.live_connection_count == old.live_connection_count,
    new.live_channel_count == old.live_channel_count + 1,
  }
}

pub fn validate_live_channel_count_decrement(
  old: HostState,
  new: HostState,
) -> Bool {
  and {
    old.live_channel_count > 0,
    new.live_client_count == old.live_client_count,
    new.live_connection_count == old.live_connection_count,
    new.live_channel_count == old.live_channel_count - 1,
  }
}

pub fn has_no_live_objects(state: HostState) -> Bool {
  and {
    state.live_client_count == 0,
    state.live_connection_count == 0,
    state.live_channel_count == 0,
  }
}

/// Validate HostState transition for client creation
/// 
/// Requirements:
/// - Version increments by 1
/// - next_client_sequence increments by 1
/// - All other sequences unchanged
/// - bound_port unchanged
/// - ibc_state_root MAY change (updated by Gateway)
/// - NFT policy unchanged
pub fn validate_create_client(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence + 1,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    validate_live_client_count_increment(old.state, new.state),
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
  }
}

/// Validate HostState transition for connection creation
pub fn validate_create_connection(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence + 1,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    validate_live_connection_count_increment(old.state, new.state),
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
  }
}

/// Validate HostState transition for channel creation
pub fn validate_create_channel(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence + 1,
    validate_live_channel_count_increment(old.state, new.state),
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
  }
}

/// Validate HostState transition for port binding
pub fn validate_bind_port(
  old: HostStateDatum,
  new: HostStateDatum,
  port_id: ByteArray,
  registration: ModuleRegistration,
) -> Bool {
  // A port can only be bound once.
  //
  // If a port already has a registration, we reject the transition.
  expect (!pairs.has_key(old.state.bound_port, port_id))?

  and {
    // Revalidate the complete identifier here so a Host-only transition can
    // never install a reserved retirement marker as a live registration.
    port_keys.is_valid_port_id(port_id),
    list.length(old.state.bound_port) < max_bound_ports,
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    validate_live_counts_unchanged(old.state, new.state),
    // Port registrations are immutable and kept in canonical CBOR map order.
    new.state.bound_port == pairs.insert_by_ascending_key(
      old.state.bound_port,
      port_id,
      registration,
      compare_port_keys_for_insertion,
    ),
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
  }
}

/// Validate HostState transitions for operations that only update the commitment root.
///
/// These operations should not:
/// - create new clients/connections/channels (so the "next_*_sequence" fields must not change)
/// - change the set of bound ports
/// - change which NFT policy identifies the HostState UTxO
///
/// They are still allowed to:
/// - increment the monotonically increasing `version`
/// - update `ibc_state_root`
/// - update `last_update_time`
pub fn validate_update_only_root(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    validate_live_counts_unchanged(old.state, new.state),
    new.state.bound_port == old.state.bound_port,
    new.shutdown == old.shutdown,
    !is_sealed(old.shutdown),
  }
}

/// Client updates remain available while users drain the bridge, but their
/// entire validity interval must end before the shutdown cutoff. This makes
/// client expiry (and therefore final reclamation) inevitable after the last
/// pre-cutoff update.
pub fn validate_update_client(
  old: HostStateDatum,
  new: HostStateDatum,
  valid_to: Int,
) -> Bool {
  and {
    validate_update_only_root(old, new),
    when old.shutdown is {
      Active -> True
      ShuttingDown { grace_period_end, .. } -> valid_to < grace_period_end
      Sealed { .. } -> False
    },
  }
}

fn validate_reclamation_shape(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    new.shutdown == old.shutdown,
    !is_sealed(old.shutdown),
  }
}

pub fn validate_reclaim_client(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_reclamation_shape(old, new),
    validate_live_client_count_decrement(old.state, new.state),
  }
}

pub fn validate_reclaim_connection(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    validate_reclamation_shape(old, new),
    validate_live_connection_count_decrement(old.state, new.state),
  }
}

pub fn validate_reclaim_channel(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    validate_reclamation_shape(old, new),
    validate_live_channel_count_decrement(old.state, new.state),
  }
}

/// Validate a liveness heartbeat which advances the HostState UTxO without
/// changing any committed IBC state.
///
/// A heartbeat is deliberately narrower than a normal root update: it may only
/// increment the version and advance the monitoring timestamp. In particular,
/// it cannot be used during shutdown or to alter the IBC root, counters, ports,
/// NFT identity, or deployer authority.
pub fn validate_heartbeat(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_update_only_root(old, new),
    old.shutdown |> is_active,
    new.state.ibc_state_root == old.state.ibc_state_root,
    new.state.last_update_time > old.state.last_update_time,
  }
}

/// Advance a registered application's independent state while preserving the
/// canonical IBC commitment. This remains available during the drain phase so
/// application children (for example zero-principal transfer escrow shards)
/// cannot strand shutdown. The top-level HostState validator binds `port_id`
/// to the registered module root and requires an operator redeemer.
pub fn validate_update_module_state(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    validate_update_only_root(old, new),
    new.state.ibc_state_root == old.state.ibc_state_root,
    new.state.last_update_time > old.state.last_update_time,
  }
}

/// Remove exactly one settled module registration during the bounded shutdown
/// cleanup phase. The IBC root is preserved deliberately: the `ports/{port}`
/// commitment remains a historical fact even after its local capability root
/// has been reclaimed.
pub fn validate_reclaim_module(
  old: HostStateDatum,
  new: HostStateDatum,
  port_id: ByteArray,
) -> Bool {
  expect Some(registration) = pairs.get_first(old.state.bound_port, port_id)
  let marker = retired_port_marker(port_id)
  expect (!pairs.has_key(old.state.bound_port, marker))?
  let without_active_port = pairs.delete_first(old.state.bound_port, port_id)
  let expected_registrations =
    pairs.insert_by_ascending_key(
      without_active_port,
      marker,
      registration,
      compare_port_keys_for_insertion,
    )

  and {
    old.shutdown |> is_shutting_down,
    has_no_live_objects(old.state),
    validate_version_increment(old.state, new.state),
    validate_live_counts_unchanged(old.state, new.state),
    new.state.ibc_state_root == old.state.ibc_state_root,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == expected_registrations,
    new.state.last_update_time > old.state.last_update_time,
    new.shutdown == old.shutdown,
  }
}

pub fn validate_enter_shutdown(
  old: HostStateDatum,
  new: HostStateDatum,
  grace_period_end: Int,
  initiated_at: Int,
) -> Bool {
  and {
    when
      (old.live_reference_script_count, old.reference_script_registration)
    is {
      (Some(reference_script_count), Some(registration)) -> and {
          reference_script_count > 0,
          reference_script_count == registration.target_count,
          old.reference_script_inventory_root == registration.target_root,
        }
      _ -> False
    },
    validate_version_increment(old.state, new.state),
    old.shutdown |> is_active,
    new.shutdown == ShuttingDown { initiated_at, grace_period_end },
    new.state.last_update_time == initiated_at,
    grace_period_end > initiated_at,
    new.state.ibc_state_root == old.state.ibc_state_root,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    validate_live_counts_unchanged(old.state, new.state),
    new.state.bound_port == old.state.bound_port,
  }
}

pub fn validate_finalize_shutdown(
  datum: HostStateDatum,
  valid_from: Int,
) -> Bool {
  when datum.shutdown is {
    ShuttingDown { grace_period_end, .. } -> valid_from >= grace_period_end
    Active | Sealed { .. } -> False
  }
}

/// Seal a fully drained HostState at the same commitment root for a fixed proof
/// window. Root-shape validation remains the responsibility of the typed
/// HostState transition; this helper establishes the lifecycle/count invariants.
pub fn validate_seal_shutdown(
  old: HostStateDatum,
  new: HostStateDatum,
  valid_from: Int,
  sealed_at: Int,
) -> Bool {
  when old.shutdown is {
    ShuttingDown { grace_period_end, .. } -> and {
        valid_from >= grace_period_end,
        has_no_live_objects(old.state),
        old.state.bound_port |> has_only_retired_ports,
        validate_version_increment(old.state, new.state),
        validate_live_counts_unchanged(old.state, new.state),
        new.state.ibc_state_root == old.state.ibc_state_root,
        new.state.next_client_sequence == old.state.next_client_sequence,
        new.state.next_connection_sequence == old.state.next_connection_sequence,
        new.state.next_channel_sequence == old.state.next_channel_sequence,
        new.state.bound_port == old.state.bound_port,
        new.state.last_update_time == sealed_at,
        new.shutdown == Sealed {
          sealed_at,
          proof_window_end: reclamation.proof_window_end(sealed_at),
        },
      }
    Active | Sealed { .. } -> False
  }
}

fn validate_reference_inventory_shape(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    new.state == HostState {
      ..old.state,
      version: old.state.version + 1,
      last_update_time: new.state.last_update_time,
    },
    new.state.last_update_time > old.state.last_update_time,
    new.shutdown == old.shutdown,
  }
}

/// Accumulate one safe-sized batch of the immutable deployment reference-script
/// inventory. A negative count marks registration as incomplete until the
/// deployer explicitly finalizes it.
pub fn validate_register_reference_scripts(
  old: HostStateDatum,
  new: HostStateDatum,
  identities: List<ReferenceScriptIdentity>,
  reference_input_count: Int,
  has_host_reference_input: Bool,
  host_script_hash: ScriptHash,
  target_count: Int,
  target_root: ByteArray,
) -> Bool {
  when identities is {
    [] -> False
    _ -> {
      expect Some(last_identity) = list.last(identities)
      let batch_count = list.length(identities)
      let expected_root =
        fold_reference_script_identities_in_order(
          old.reference_script_inventory_root,
          identities,
        )
      let expected_registration =
        ReferenceScriptRegistration {
          target_count,
          target_root,
          last_out_ref: last_identity.output_reference,
        }
      and {
        old.shutdown |> is_active,
        target_count > 0,
        target_count <= max_reference_script_inventory_count,
        bytearray.length(target_root) == 32,
        new.reference_script_inventory_root == expected_root,
        when old.live_reference_script_count is {
          None ->
            when identities is {
              [host_identity, first_non_host, ..remaining_non_host] -> {
                let non_host_identities = [first_non_host, ..remaining_non_host]
                and {
                  is_host_reference_script(host_identity, host_script_hash),
                  list.all(
                    non_host_identities,
                    fn(identity) {
                      !is_host_reference_script(identity, host_script_hash)
                    },
                  ),
                  reference_script_identities_are_canonical(non_host_identities),
                  reference_input_count == batch_count,
                  old.reference_script_inventory_root == empty_reference_script_inventory_root,
                  old.reference_script_registration == None,
                  batch_count <= target_count,
                  new.live_reference_script_count == Some(-batch_count),
                  new.reference_script_registration == Some(
                    expected_registration,
                  ),
                }
              }
              _ -> False
            }
          Some(accumulated) ->
            when old.reference_script_registration is {
              Some(registration) -> {
                let next_accumulated = accumulated - batch_count
                and {
                  accumulated < 0,
                  registration.target_count == target_count,
                  registration.target_root == target_root,
                  reference_script_identities_are_canonical(identities),
                  has_host_reference_input,
                  list.all(
                    identities,
                    fn(identity) {
                      and {
                        !is_host_reference_script(identity, host_script_hash),
                        compare_output_references(
                          registration.last_out_ref,
                          identity.output_reference,
                        ) == Less,
                      }
                    },
                  ),
                  reference_input_count == batch_count + 1,
                  -next_accumulated <= target_count,
                  new.live_reference_script_count == Some(next_accumulated),
                  new.reference_script_registration == Some(
                    expected_registration,
                  ),
                }
              }
              None -> False
            }
        },
        validate_reference_inventory_shape(old, new),
      }
    }
  }
}

/// Commit a completed batched registration by converting its negative sentinel
/// into the positive live inventory used by shutdown and reclamation.
pub fn validate_finalize_reference_script_registration(
  old: HostStateDatum,
  new: HostStateDatum,
) -> Bool {
  and {
    old.shutdown |> is_active,
    when
      (old.live_reference_script_count, old.reference_script_registration)
    is {
      (Some(accumulated), Some(registration)) -> and {
          accumulated < 0,
          -accumulated == registration.target_count,
          old.reference_script_inventory_root == registration.target_root,
          new.live_reference_script_count == Some(registration.target_count),
          new.reference_script_inventory_root == old.reference_script_inventory_root,
          new.reference_script_registration == old.reference_script_registration,
        }
      _ -> False
    },
    validate_reference_inventory_shape(old, new),
  }
}

/// A positive registered inventory can be reclaimed only after the terminal
/// proof window. HostState remains present as the authenticated coordinator.
fn terminal_proof_window_reached(datum: HostStateDatum, valid_from: Int) -> Bool {
  when datum.shutdown is {
    Sealed { proof_window_end, .. } -> and {
        has_no_live_objects(datum.state),
        reclamation.has_reached_not_before(valid_from, proof_window_end),
      }
    Active | ShuttingDown { .. } -> False
  }
}

pub fn is_reference_script_reclaimable(
  datum: HostStateDatum,
  valid_from: Int,
) -> Bool {
  and {
    terminal_proof_window_reached(datum, valid_from),
    when
      (datum.live_reference_script_count, datum.reference_script_registration)
    is {
      (Some(count), Some(registration)) -> and {
          count > 0,
          count <= registration.target_count,
          registration.target_count <= max_reference_script_inventory_count,
        }
      _ -> False
    },
  }
}

/// Decrement the authenticated inventory by the exact positive number of
/// reference-script inputs consumed in this transaction.
pub fn validate_reclaim_reference_scripts(
  old: HostStateDatum,
  new: HostStateDatum,
  identities: List<ReferenceScriptIdentity>,
  predecessor_root: ByteArray,
  valid_from: Int,
  host_script_hash: ScriptHash,
) -> Bool {
  expect Some(old_count) = old.live_reference_script_count
  let reclaimed_count = list.length(identities)
  let reclaims_host_reference =
    list.any(
      identities,
      fn(identity) { is_host_reference_script(identity, host_script_hash) },
    )
  and {
    is_reference_script_reclaimable(old, valid_from),
    reclaimed_count > 0,
    reclaimed_count <= old_count,
    // The Host validator reference is the first chain entry and is reserved
    // for the atomic Host NFT burn. Consuming it through this successor-based
    // transition would remove the witness needed by a later final burn.
    !reclaims_host_reference,
    append_reference_script_identities(predecessor_root, identities) == old.reference_script_inventory_root,
    new.live_reference_script_count == Some(old_count - reclaimed_count),
    new.reference_script_inventory_root == predecessor_root,
    new.reference_script_registration == old.reference_script_registration,
    if old_count == reclaimed_count {
      predecessor_root == empty_reference_script_inventory_root
    } else {
      True
    },
    validate_reference_inventory_shape(old, new),
  }
}

/// Validate the normal atomic terminal path while the HostState validator
/// reference is the sole remaining authenticated inventory entry.
pub fn is_host_state_reclaimable_with_terminal_reference(
  datum: HostStateDatum,
  terminal_identity: ReferenceScriptIdentity,
  valid_from: Int,
  host_script_hash: ScriptHash,
) -> Bool {
  and {
    terminal_proof_window_reached(datum, valid_from),
    datum.live_reference_script_count == Some(1),
    terminal_identity.reference_script_hash == host_script_hash,
    datum.reference_script_inventory_root == fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [terminal_identity],
    ),
    when datum.reference_script_registration is {
      // Target bounds were authenticated at first registration and this field
      // is immutable thereafter; terminal validation only needs its presence.
      Some(_) -> True
      None -> False
    },
  }
}
