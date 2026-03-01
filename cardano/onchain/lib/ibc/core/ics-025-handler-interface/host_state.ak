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
use aiken/primitive/int

// Empty ICS-23 Merkle tree root (32 bytes of zeros)
pub const empty_ibc_state_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

// IBC Host State NFT token name
pub const host_state_token_name = "ibc_host_state"

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
  // List of bound port identifiers
  bound_port: List<Int>,
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
  let HostStateDatum { state, nft_policy } = datum
  and {
    state.version == 0,
    state.next_client_sequence == 0,
    state.next_connection_sequence == 0,
    state.next_channel_sequence == 0,
    state.bound_port == [],
    state.ibc_state_root == empty_ibc_state_root,
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
    new.nft_policy == old.nft_policy,
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
    new.nft_policy == old.nft_policy,
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
    new.nft_policy == old.nft_policy,
  }
}

/// Validate HostState transition for port binding
pub fn validate_bind_port(
  old: HostStateDatum,
  new: HostStateDatum,
  port: Int,
) -> Bool {
  // A port can only be bound once.
  //
  // If a port is already in the list, we reject the transition.
  expect
    if list.has(old.state.bound_port, port) {
      False
    } else {
      True
    }

  and {
    validate_version_increment(old.state, new.state),
    new.state.next_client_sequence == old.state.next_client_sequence,
    new.state.next_connection_sequence == old.state.next_connection_sequence,
    new.state.next_channel_sequence == old.state.next_channel_sequence,
    // Port list should have the new port added and be sorted.
    new.state.bound_port == (
      list.push(old.state.bound_port, port) |> list.sort(int.compare)
    ),
    new.nft_policy == old.nft_policy,
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
    new.nft_policy == old.nft_policy,
  }
}
