use aiken/builtin
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
use aiken/crypto.{Blake2b_224, Hash, Script, VerificationKeyHash}
use aiken/primitive/bytearray
use ibc/auth.{AuthToken}

// Empty ICS-23 Merkle tree root (32 bytes of zeros)
pub const empty_ibc_state_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// IBC Host State NFT token name
pub const host_state_token_name = "ibc_host_state"

/// Bound ports are permanent protocol registrations, so their aggregate state
/// must have a ledger-safe upper bound. The deployment currently registers
/// three ports and can add up to this fixed protocol-wide maximum.
pub const max_bound_ports = 10

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
}

pub fn is_active(shutdown: ShutdownState) -> Bool {
  when shutdown is {
    Active -> True
    ShuttingDown { .. } -> False
  }
}

pub fn is_shutting_down(shutdown: ShutdownState) -> Bool {
  when shutdown is {
    Active -> False
    ShuttingDown { .. } -> True
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
  let HostStateDatum { state, nft_policy, shutdown, .. } = datum
  and {
    state.version == 0,
    state.next_client_sequence == 0,
    state.next_connection_sequence == 0,
    state.next_channel_sequence == 0,
    state.bound_port == [],
    state.ibc_state_root == empty_ibc_state_root,
    shutdown == Active,
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
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
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
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
  }
}

/// Validate HostState transition for channel creation
pub fn validate_create_channel(old: HostStateDatum, new: HostStateDatum) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence + 1,
    new.state.bound_port == old.state.bound_port,
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
  }
}

/// Validate HostState transition for port binding
pub fn validate_bind_port(
  old: HostStateDatum,
  new: HostStateDatum,
  port_id: ByteArray,
  registration: ModuleRegistration,
) -> Bool {
  let port_id_length = bytearray.length(port_id)

  // A port can only be bound once.
  //
  // If a port already has a registration, we reject the transition.
  expect (!pairs.has_key(old.state.bound_port, port_id))?

  and {
    // The minting policy enforces the complete ICS identifier alphabet while
    // HostState cheaply retains the consensus-critical textual length bound.
    port_id_length >= 2,
    port_id_length <= 128,
    list.length(old.state.bound_port) < max_bound_ports,
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    // Port registrations are immutable and kept in canonical CBOR map order.
    new.state.bound_port == pairs.insert_by_ascending_key(
      old.state.bound_port,
      port_id,
      registration,
      compare_port_keys_for_insertion,
    ),
    old.shutdown |> is_active,
    new.shutdown == old.shutdown,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
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
    new.state.bound_port == old.state.bound_port,
    new.shutdown == old.shutdown,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
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

pub fn validate_enter_shutdown(
  old: HostStateDatum,
  new: HostStateDatum,
  grace_period_end: Int,
) -> Bool {
  and {
    validate_version_increment(old.state, new.state),
    old.shutdown |> is_active,
    new.shutdown == ShuttingDown {
      initiated_at: new.state.last_update_time,
      grace_period_end,
    },
    grace_period_end > new.state.last_update_time,
    new.state.ibc_state_root == old.state.ibc_state_root,
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    new.state.bound_port == old.state.bound_port,
    new.nft_policy == old.nft_policy,
    new.deployer == old.deployer,
  }
}

pub fn validate_finalize_shutdown(
  datum: HostStateDatum,
  valid_from: Int,
) -> Bool {
  when datum.shutdown is {
    ShuttingDown { grace_period_end, .. } -> valid_from >= grace_period_end
    Active -> False
  }
}
