use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/fuzz
use aiken/interval
use aiken/primitive/bytearray
use aiken/primitive/int
use aiken/primitive/string
use cardano/address.{Address, Script, from_verification_key}
use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction, placeholder,
}
use host_state_stt
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer as client_redeemer
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header as client_header
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_002_client_semantics/types/keys as client_id_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionActive, ConnectionDatum, Retiring,
}
use ibc/core/ics_003_connection_semantics/connection_redeemer as connection_redeemer
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_004/channel_datum.{
  Abandoning, ChannelActive, ChannelDatum, ChannelDatumState,
  max_packet_entries_per_channel,
}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, PrunePacketHistory as PruneChannelPacketHistory, RecvPacket,
  SendPacket, SpendChannelRedeemer, TimeoutPacket,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnChanReclaim, OnHostStateSeal, Operator,
  OtherModuleOperator,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ModuleRegistration, ReferenceScriptIdentity,
  ReferenceScriptRegistration, Sealed, ShutdownState, ShuttingDown,
  append_reference_script_identities, empty_ibc_state_root,
  empty_reference_script_inventory_root, host_state_token_name, max_bound_ports,
  retired_port_marker, validate_bind_port,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, CreateChannel, CreateClient, CreateConnection, EnterShutdown,
  FinalizeReferenceScriptRegistration, FinalizeShutdown, HandlePacket, Heartbeat,
  HostStateRedeemer, PruneTerminalClient, ReclaimChannel, ReclaimClient,
  ReclaimConnection, ReclaimHostState, ReclaimModule, ReclaimReferenceScripts,
  RegisterReferenceScripts, SealShutdown, UpdateChannel, UpdateClient,
  UpdateConnection, UpdateModuleState,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeCreation, AuthorizeLifecycle, AuthorizeOperation, AuthorizePacket,
  LifecycleCreationMarkerRedeemer, LifecycleMarkerRedeemer,
  LifecycleOperationalMarkerRedeemer, LifecyclePacketMarkerRedeemer,
  lifecycle_marker_token_name,
}
use ibc/core/ics_025_handler_interface/reclamation
use ibc/testing/fuzz_dsl
use ibc/utils/bits
use ibc/utils/validator_utils
use minting_lifecycle_creation_marker
use minting_lifecycle_marker
use minting_lifecycle_operational_marker
use minting_lifecycle_packet_marker

// Build a list with `count` copies of `value`.
fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn packet_entries(
  sequence: Int,
  last_sequence: Int,
  value: ByteArray,
) -> Pairs<Int, ByteArray> {
  if sequence > last_sequence {
    []
  } else {
    [
      Pair(sequence, value),
      ..packet_entries(sequence + 1, last_sequence, value)
    ]
  }
}

fn port_commitment_key(port_id: ByteArray) -> ByteArray {
  key_port_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(port_id)
}

fn test_port_id(port: Int) -> ByteArray {
  let suffix = port |> string.from_int |> string.to_bytearray
  bytearray.concat("port-", suffix)
}

fn test_module_registration(
  module_script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
) -> ModuleRegistration {
  ModuleRegistration {
    module_script_hash,
    port_token: AuthToken { policy_id: "mock port policy", name: "mock port" },
    module_token: AuthToken {
      policy_id: "mock module policy",
      name: "mock module",
    },
  }
}

fn test_module_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"915f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b379"
}

fn test_reference_script_hash() -> crypto.Hash<
  crypto.Blake2b_224,
  crypto.Script,
> {
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

fn test_module_output(registration: ModuleRegistration) -> Output {
  Output {
    address: Address(Script(registration.module_script_hash), None),
    value: from_asset(
      registration.port_token.policy_id,
      registration.port_token.name,
      1,
    )
      |> add(
          registration.module_token.policy_id,
          registration.module_token.name,
          1,
        ),
    datum: NoDatum,
    reference_script: None,
  }
}

test module_registration_cbor_matches_offchain_codec() {
  let registration =
    ModuleRegistration {
      module_script_hash: #"11111111111111111111111111111111111111111111111111111111",
      port_token: AuthToken {
        policy_id: #"22222222222222222222222222222222222222222222222222222222",
        name: #"01",
      },
      module_token: AuthToken {
        policy_id: #"33333333333333333333333333333333333333333333333333333333",
        name: #"02",
      },
    }

  cbor.serialise(registration) == #"d8799f581c11111111111111111111111111111111111111111111111111111111d8799f581c222222222222222222222222222222222222222222222222222222224101ffd8799f581c333333333333333333333333333333333333333333333333333333334102ffff"
}

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

fn test_host_state_datum(
  state: HostState,
  nft_policy: PolicyId,
) -> HostStateDatum {
  HostStateDatum {
    state,
    nft_policy,
    deployer: trusted_deployer,
    shutdown: Active,
    live_reference_script_count: Some(0),
    reference_script_inventory_root: empty_ibc_state_root,
    reference_script_registration: None,
  }
}

fn test_host_state_datum_with_shutdown(
  state: HostState,
  nft_policy: PolicyId,
  shutdown: ShutdownState,
) -> HostStateDatum {
  HostStateDatum {
    state,
    nft_policy,
    deployer: trusted_deployer,
    shutdown,
    live_reference_script_count: Some(0),
    reference_script_inventory_root: empty_ibc_state_root,
    reference_script_registration: None,
  }
}

fn test_channel_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock channel policy",
    name: auth.generate_token_name(base_token, channel_keys.channel_prefix, "0"),
  }
}

fn test_channel(state: channel_state.ChannelState) -> Channel {
  Channel {
    state,
    ordering: channel_order.Unordered,
    counterparty: ChannelCounterparty {
      port_id: "transfer",
      channel_id: "channel-1",
    },
    connection_hops: ["connection-0"],
    version: "ics20-1",
  }
}

fn test_channel_datum(
  channel: Channel,
  next_sequence_send: Int,
  packet_commitment: Pairs<Int, ByteArray>,
) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      maximum_receive_proof_height: height_mod.zero_height(),
      minimum_receive_proof_height: height_mod.zero_height(),
      channel,
      next_sequence_send,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment,
      packet_receipt: [],
      packet_acknowledgement: [],
    },
    port_id: "transfer",
    token: test_channel_token(),
    lifecycle: ChannelActive,
    voucher_supply: 0,
  }
}

fn positive_seed(seed: Int) -> Int {
  if seed < 0 {
    -seed
  } else {
    seed
  }
}

fn test_sequence(seed: Int) -> Int {
  positive_seed(seed % 30) + 1
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn key_bit(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn last_different_key_bit(
  first_hash: ByteArray,
  second_hash: ByteArray,
  depth: Int,
  last_difference: Int,
) -> Int {
  if depth == ibc_state_commitment.merkle_depth_bits {
    expect last_difference >= 0
    last_difference
  } else {
    last_different_key_bit(
      first_hash,
      second_hash,
      depth + 1,
      if key_bit(first_hash, depth) != key_bit(second_hash, depth) {
        depth
      } else {
        last_difference
      },
    )
  }
}

fn raise_single_leaf(
  key_hash: ByteArray,
  current: ByteArray,
  depth: Int,
  target_depth: Int,
) -> ByteArray {
  if depth == target_depth {
    current
  } else {
    let next =
      if key_bit(key_hash, depth) == 0 {
        ibc_state_commitment.inner_hash(
          current,
          ibc_state_commitment.empty_hash,
        )
      } else {
        ibc_state_commitment.inner_hash(
          ibc_state_commitment.empty_hash,
          current,
        )
      }
    raise_single_leaf(key_hash, next, depth + 1, target_depth)
  }
}

fn single_sibling_list(
  depth: Int,
  sibling_depth: Int,
  sibling: ByteArray,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    [
      if depth == sibling_depth {
        sibling
      } else {
        ibc_state_commitment.empty_hash
      },
      ..single_sibling_list(depth + 1, sibling_depth, sibling)
    ]
  }
}

/// Build a sparse-tree proof for a missing target key when the tree currently
/// contains exactly one populated leaf.
fn siblings_after_single_insert(
  existing_key: ByteArray,
  existing_value: ByteArray,
  target_key: ByteArray,
) -> List<ByteArray> {
  let existing_key_hash = builtin.sha2_256(existing_key)
  let target_key_hash = builtin.sha2_256(target_key)
  let divergence =
    last_different_key_bit(existing_key_hash, target_key_hash, 0, -1)
  let existing_leaf =
    ibc_state_commitment.leaf_hash(
      existing_key_hash,
      ibc_state_commitment.value_hash(existing_value),
    )
  let sibling =
    raise_single_leaf(existing_key_hash, existing_leaf, 0, divergence)
  single_sibling_list(0, divergence, sibling)
}

fn two_sibling_list(
  depth: Int,
  first_depth: Int,
  first_sibling: ByteArray,
  second_depth: Int,
  second_sibling: ByteArray,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    [
      if depth == first_depth {
        first_sibling
      } else if depth == second_depth {
        second_sibling
      } else {
        ibc_state_commitment.empty_hash
      },
      ..two_sibling_list(
        depth + 1,
        first_depth,
        first_sibling,
        second_depth,
        second_sibling,
      )
    ]
  }
}

/// Build a missing-key proof for two leaves whose paths join the target at
/// different depths. This is the shape used by the composed receive fixture.
fn siblings_after_two_inserts(
  first_key: ByteArray,
  first_value: ByteArray,
  second_key: ByteArray,
  second_value: ByteArray,
  target_key: ByteArray,
) -> List<ByteArray> {
  let first_key_hash = builtin.sha2_256(first_key)
  let second_key_hash = builtin.sha2_256(second_key)
  let target_key_hash = builtin.sha2_256(target_key)
  let first_divergence =
    last_different_key_bit(first_key_hash, target_key_hash, 0, -1)
  let second_divergence =
    last_different_key_bit(second_key_hash, target_key_hash, 0, -1)
  expect first_divergence != second_divergence
  let first_leaf =
    ibc_state_commitment.leaf_hash(
      first_key_hash,
      ibc_state_commitment.value_hash(first_value),
    )
  let second_leaf =
    ibc_state_commitment.leaf_hash(
      second_key_hash,
      ibc_state_commitment.value_hash(second_value),
    )
  two_sibling_list(
    0,
    first_divergence,
    raise_single_leaf(first_key_hash, first_leaf, 0, first_divergence),
    second_divergence,
    raise_single_leaf(second_key_hash, second_leaf, 0, second_divergence),
  )
}

/// Compute a sparse subtree containing `leaves` after `levels` leaf-to-root
/// hashing steps. This lets integration fixtures derive canonical witnesses
/// after any number of preceding inserts instead of assuming an empty tree.
fn sparse_subtree_hash(
  leaves: Pairs<ByteArray, ByteArray>,
  levels: Int,
) -> ByteArray {
  if list.is_empty(leaves) {
    ibc_state_commitment.empty_hash
  } else if levels == 0 {
    when leaves is {
      [] -> ibc_state_commitment.empty_hash
      [Pair(key, value)] ->
        ibc_state_commitment.leaf_hash(
          builtin.sha2_256(key),
          ibc_state_commitment.value_hash(value),
        )
      _ -> fail @"fixture sparse-tree leaf collision"
    }
  } else {
    let bit = levels - 1
    let left =
      list.filter(
        leaves,
        fn(pair) { key_bit(builtin.sha2_256(pair.1st), bit) == 0 },
      )
    let right =
      list.filter(
        leaves,
        fn(pair) { key_bit(builtin.sha2_256(pair.1st), bit) == 1 },
      )
    ibc_state_commitment.inner_hash(
      sparse_subtree_hash(left, bit),
      sparse_subtree_hash(right, bit),
    )
  }
}

fn sparse_siblings_go(
  leaves: Pairs<ByteArray, ByteArray>,
  target_key_hash: ByteArray,
  depth: Int,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    let sibling_leaves =
      list.filter(
        leaves,
        fn(pair) {
          last_different_key_bit(
            builtin.sha2_256(pair.1st),
            target_key_hash,
            0,
            -1,
          ) == depth
        },
      )
    [
      sparse_subtree_hash(sibling_leaves, depth),
      ..sparse_siblings_go(leaves, target_key_hash, depth + 1)
    ]
  }
}

/// Canonical non-membership/update witness for `target_key` in the exact
/// sparse tree represented by `leaves`. The target itself is excluded because
/// a leaf never appears in its own sibling path.
fn sparse_siblings(
  leaves: Pairs<ByteArray, ByteArray>,
  target_key: ByteArray,
) -> List<ByteArray> {
  sparse_siblings_go(
    list.filter(leaves, fn(pair) { pair.1st != target_key }),
    builtin.sha2_256(target_key),
    0,
  )
}

fn sparse_root(leaves: Pairs<ByteArray, ByteArray>) -> ByteArray {
  sparse_subtree_hash(leaves, ibc_state_commitment.merkle_depth_bits)
}

fn test_nft_policy() -> PolicyId {
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
}

fn test_lifecycle_creation_policy() -> PolicyId {
  #"c477ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca754"
}

fn test_lifecycle_reclamation_policy() -> PolicyId {
  #"d577ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca755"
}

fn test_lifecycle_operational_policy() -> PolicyId {
  #"e677ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca756"
}

fn test_lifecycle_packet_policy() -> PolicyId {
  #"f777ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca757"
}

fn test_voucher_policy() -> PolicyId {
  #"a877ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca758"
}

fn test_host_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
}

fn test_client_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"c15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b373"
}

fn test_connection_script_hash() -> crypto.Hash<
  crypto.Blake2b_224,
  crypto.Script,
> {
  #"b15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
}

fn test_channel_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
}

fn test_host_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }
}

fn test_object_ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: index,
  }
}

fn test_host_state(root: ByteArray, seed: Int) -> HostState {
  let version = positive_seed(seed % 50)
  HostState {
    version,
    ibc_state_root: root,
    next_client_sequence: 0,
    next_connection_sequence: 0,
    next_channel_sequence: 0,
    bound_port: [],
    last_update_time: positive_seed(seed),
    live_client_count: 0,
    live_connection_count: 0,
    live_channel_count: 0,
  }
}

fn test_bound_ports(
  ports: List<ByteArray>,
) -> Pairs<ByteArray, ModuleRegistration> {
  when ports is {
    [] -> []
    [port_id, ..rest] ->
      [
        Pair(port_id, test_module_registration(test_module_script_hash())),
        ..test_bound_ports(rest)
      ]
  }
}

fn test_bind_port_transition(
  old_ports: List<ByteArray>,
  new_ports: List<ByteArray>,
  port_id: ByteArray,
) -> Bool {
  let nft_policy = test_nft_policy()
  let registration = test_module_registration(test_module_script_hash())
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      bound_port: test_bound_ports(old_ports),
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      bound_port: test_bound_ports(new_ports),
    }
  validate_bind_port(
    test_host_state_datum(old_state, nft_policy),
    test_host_state_datum(new_state, nft_policy),
    port_id,
    registration,
  )
}

fn test_host_input(state: HostState) -> Input {
  let nft_policy = test_nft_policy()
  Input(
    test_host_ref(),
    Output {
      address: Address(Script(test_host_script_hash()), None),
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(state, nft_policy)),
      reference_script: None,
    },
  )
}

fn test_host_output(state: HostState) -> Output {
  let nft_policy = test_nft_policy()
  Output {
    address: Address(Script(test_host_script_hash()), None),
    value: from_asset(nft_policy, host_state_token_name, 1),
    datum: InlineDatum(test_host_state_datum(state, nft_policy)),
    reference_script: None,
  }
}

fn test_unrelated_outputs(count: Int) -> List<Output> {
  list.repeat(
    test_module_output(test_module_registration(test_module_script_hash())),
    count,
  )
}

fn lifecycle_policy_for(redeemer: HostStateRedeemer) -> Option<PolicyId> {
  when redeemer is {
    CreateClient { .. } | CreateConnection { .. } | CreateChannel { .. } ->
      Some(test_lifecycle_creation_policy())
    PruneTerminalClient { .. } |
    ReclaimClient { .. } |
    ReclaimConnection { .. } |
    ReclaimChannel { .. } |
    ReclaimModule { .. } -> Some(test_lifecycle_reclamation_policy())
    BindPort { .. } |
    UpdateClient { .. } |
    UpdateConnection { .. } |
    UpdateChannel { .. } -> Some(test_lifecycle_operational_policy())
    HandlePacket { .. } -> Some(test_lifecycle_packet_policy())
    _ -> None
  }
}

fn with_lifecycle_marker(
  redeemer: HostStateRedeemer,
  transaction: Transaction,
) -> Transaction {
  when lifecycle_policy_for(redeemer) is {
    None -> transaction
    Some(policy) -> {
      let marked = with_policy_marker(policy, transaction)
      let host_redeemer_data: Redeemer = redeemer
      let marker_redeemer_data: Redeemer =
        when redeemer is {
          CreateClient { .. } | CreateConnection { .. } | CreateChannel { .. } -> {
            let value: LifecycleCreationMarkerRedeemer = AuthorizeCreation
            let encoded: Redeemer = value
            encoded
          }
          BindPort { .. } |
          UpdateClient { .. } |
          UpdateConnection { .. } |
          UpdateChannel { .. } -> {
            let value: LifecycleOperationalMarkerRedeemer = AuthorizeOperation
            let encoded: Redeemer = value
            encoded
          }
          HandlePacket { .. } -> {
            let value: LifecyclePacketMarkerRedeemer = AuthorizePacket
            let encoded: Redeemer = value
            encoded
          }
          PruneTerminalClient { .. } |
          ReclaimClient { .. } |
          ReclaimConnection { .. } |
          ReclaimChannel { .. } |
          ReclaimModule { .. } -> {
            let value: LifecycleMarkerRedeemer = AuthorizeLifecycle
            let encoded: Redeemer = value
            encoded
          }
          _ -> fail
        }
      let object_redeemers =
        when redeemer is {
          UpdateClient { .. } -> {
            let client_spend: Redeemer =
              client_redeemer.UpdateClient {
                msg: HeaderCase(client_header.null_header()),
              }
            [Pair(Spend(test_object_ref(1)), client_spend)]
          }
          PruneTerminalClient { .. } -> {
            let client_spend: Redeemer =
              client_redeemer.PruneTerminalConsensusStates
            [Pair(Spend(test_object_ref(1)), client_spend)]
          }
          _ -> []
        }
      Transaction {
        ..marked,
        validity_range: when redeemer is {
          UpdateClient { .. } -> interval.between(-1, 0)
          PruneTerminalClient { .. } | ReclaimClient { .. } -> interval.after(0)
          _ -> marked.validity_range
        },
        redeemers: list.concat(
          [
            Pair(Spend(test_host_ref()), host_redeemer_data),
            Pair(Mint(policy), marker_redeemer_data),
          ],
          list.concat(object_redeemers, marked.redeemers),
        ),
      }
    }
  }
}

fn with_policy_marker(policy: PolicyId, transaction: Transaction) -> Transaction {
  Transaction {
    ..transaction,
    mint: transaction.mint |> add(policy, "ibc_lifecycle", 1),
    outputs: list.map(
      transaction.outputs,
      fn(output) {
        if assets.has_nft(
          output.value,
          test_nft_policy(),
          host_state_token_name,
        ) {
          Output {
            ..output,
            value: output.value |> add(policy, "ibc_lifecycle", 1),
          }
        } else {
          output
        }
      },
    ),
  }
}

fn validate_delegated_marker(
  redeemer: HostStateRedeemer,
  transaction: Transaction,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  channel_policy: PolicyId,
) -> Bool {
  when redeemer is {
    BindPort { .. } |
    UpdateClient { .. } |
    UpdateConnection { .. } |
    UpdateChannel { .. } ->
      minting_lifecycle_operational_marker.mint_lifecycle_operational_marker.mint(
        test_nft_policy(),
        test_client_script_hash(),
        test_connection_script_hash(),
        test_channel_script_hash(),
        client_policy,
        connection_policy,
        channel_policy,
        AuthorizeOperation,
        test_lifecycle_operational_policy(),
        transaction,
      )
    HandlePacket { .. } ->
      minting_lifecycle_packet_marker.mint_lifecycle_packet_marker.mint(
        test_nft_policy(),
        test_channel_script_hash(),
        channel_policy,
        test_voucher_policy(),
        AuthorizePacket,
        test_lifecycle_packet_policy(),
        transaction,
      )
    PruneTerminalClient { .. } |
    ReclaimClient { .. } |
    ReclaimConnection { .. } |
    ReclaimChannel { .. } |
    ReclaimModule { .. } ->
      minting_lifecycle_marker.mint_lifecycle_marker.mint(
        test_nft_policy(),
        client_policy,
        connection_policy,
        channel_policy,
        AuthorizeLifecycle,
        test_lifecycle_reclamation_policy(),
        transaction,
      )
    _ -> True
  }
}

fn spend_host_state(
  redeemer: HostStateRedeemer,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  spend_host_state_with_signatories(redeemer, inputs, outputs, [])
}

fn spend_host_state_with_expected_policies(
  redeemer: HostStateRedeemer,
  inputs: List<Input>,
  outputs: List<Output>,
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  let transaction =
    with_lifecycle_marker(
      redeemer,
      Transaction { ..placeholder, inputs, outputs },
    )
  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      client_minting_policy_id,
      connection_minting_policy_id,
      channel_minting_policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      redeemer,
      transaction,
      client_minting_policy_id,
      connection_minting_policy_id,
      channel_minting_policy_id,
    ),
  }
}

fn spend_host_state_with_signatories(
  redeemer: HostStateRedeemer,
  inputs: List<Input>,
  outputs: List<Output>,
  extra_signatories: List<crypto.VerificationKeyHash>,
) -> Bool {
  let transaction =
    with_lifecycle_marker(
      redeemer,
      Transaction { ..placeholder, inputs, outputs, extra_signatories },
    )
  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      redeemer,
      transaction,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
    ),
  }
}

fn spend_host_state_with_channel_redeemer(
  redeemer: HostStateRedeemer,
  channel_redeemer: SpendChannelRedeemer,
  channel_input: Input,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  spend_host_state_with_channel_redeemer_and_voucher_action(
    redeemer,
    channel_redeemer,
    channel_input,
    inputs,
    outputs,
    False,
  )
}

fn spend_host_state_with_channel_redeemer_and_voucher_action(
  redeemer: HostStateRedeemer,
  channel_redeemer: SpendChannelRedeemer,
  channel_input: Input,
  inputs: List<Input>,
  outputs: List<Output>,
  voucher_action: Bool,
) -> Bool {
  let channel_redeemer_data: Redeemer = channel_redeemer
  let marked_transaction =
    with_lifecycle_marker(
      redeemer,
      Transaction {
        ..placeholder,
        inputs,
        outputs,
        redeemers: [
          Pair(Spend(channel_input.output_reference), channel_redeemer_data),
        ],
      },
    )
  let transaction =
    if voucher_action {
      Transaction {
        ..marked_transaction,
        mint: marked_transaction.mint
          |> add(test_voucher_policy(), "voucher", 1),
      }
    } else {
      marked_transaction
    }
  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      redeemer,
      transaction,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
    ),
  }
}

fn test_packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "transfer",
    source_channel: "channel-0",
    destination_port: "transfer",
    destination_channel: "channel-1",
    data: "packet-data",
    timeout_height: Height { revision_number: 0, revision_height: 0 },
    timeout_timestamp: 1,
  }
}

fn empty_proof() -> MerkleProof {
  MerkleProof { proofs: [] }
}

fn spend_test_bind_port(
  old_ports: List<ByteArray>,
  new_ports: List<ByteArray>,
  port_id: ByteArray,
  extra_signatories: List<crypto.VerificationKeyHash>,
) -> Bool {
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      bound_port: test_bound_ports(old_ports),
    }
  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_commitment_key(port_id),
      "",
      cbor.serialise(registration),
      port_siblings,
    )
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: test_bound_ports(new_ports),
    }

  spend_host_state_with_signatories(
    BindPort { port_id, registration, port_siblings },
    [test_host_input(old_state)],
    [test_host_output(new_state), test_module_output(registration)],
    extra_signatories,
  )
}

fn validate_bind_port_module_outputs(module_outputs: List<Output>) -> Bool {
  let registration = test_module_registration(test_module_script_hash())
  let port_id = "transfer"
  let port_siblings = full_empty_siblings()
  let old_state = test_host_state(empty_ibc_state_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: ibc_state_commitment.apply_update(
        old_state.ibc_state_root,
        port_commitment_key(port_id),
        "",
        cbor.serialise(registration),
        port_siblings,
      ),
      bound_port: [Pair(port_id, registration)],
    }
  spend_host_state_with_signatories(
    BindPort { port_id, registration, port_siblings },
    [test_host_input(old_state)],
    [test_host_output(new_state), ..module_outputs],
    [trusted_deployer],
  )
}

test lifecycle_operational_marker_rejects_bind_port_wrong_module_value() fail {
  let registration = test_module_registration(test_module_script_hash())
  validate_bind_port_module_outputs(
    [
      Output {
        ..test_module_output(registration),
        value: from_asset(
          registration.port_token.policy_id,
          registration.port_token.name,
          1,
        ),
      },
    ],
  )
}

test lifecycle_operational_marker_rejects_bind_port_duplicate_module_output() fail {
  let module_output =
    test_module_output(test_module_registration(test_module_script_hash()))
  validate_bind_port_module_outputs([module_output, module_output])
}

fn test_client_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock client policy",
    name: auth.generate_token_name(
      base_token,
      client_id_keys.client_prefix,
      "0",
    ),
  }
}

fn test_height(revision_height: Int) -> Height {
  Height { revision_number: 0, revision_height }
}

fn test_consensus_state(seed: Int) -> ConsensusState {
  ConsensusState {
    timestamp: positive_seed(seed) + 1,
    next_validators_hash: #"010203",
    root: MerkleRoot { hash: #"040506" },
  }
}

fn test_client_state(latest_height: Height) -> ClientState {
  ClientState {
    chain_id: "chain-0",
    trust_level: UncheckedRational { numerator: 1, denominator: 3 },
    trusting_period: 1000,
    unbonding_period: 2000,
    max_clock_drift: 10,
    frozen_height: test_height(0),
    latest_height,
    proof_specs: [],
  }
}

fn test_client_datum(latest_height: Int, seed: Int) -> ClientDatum {
  let height = test_height(latest_height)
  ClientDatum {
    state: ClientDatumState {
      client_state: test_client_state(height),
      consensus_states: [Pair(height, test_consensus_state(seed))],
      processed_times: [Pair(height, 0)],
      processed_heights: [Pair(height, 0)],
    },
    token: test_client_token(),
  }
}

fn test_misbehaviour_client_datum(seed: Int) -> ClientDatum {
  let datum = test_client_datum(1, seed)
  let conflicting_height = test_height(0)
  ClientDatum {
    ..datum,
    state: ClientDatumState {
      ..datum.state,
      consensus_states: [
        Pair(conflicting_height, test_consensus_state(seed + 1)),
        ..datum.state.consensus_states
      ],
      processed_times: [
        Pair(conflicting_height, 0),
        ..datum.state.processed_times
      ],
      processed_heights: [
        Pair(conflicting_height, 0),
        ..datum.state.processed_heights
      ],
    },
  }
}

fn test_updated_client_datum(seed: Int) -> ClientDatum {
  let input = test_misbehaviour_client_datum(seed)
  ClientDatum {
    ..input,
    state: ClientDatumState {
      ..input.state,
      client_state: ClientState {
        ..input.state.client_state,
        frozen_height: test_height(1),
      },
    },
  }
}

fn test_client_input(datum: ClientDatum) -> Input {
  let token = test_client_token()
  Input(
    test_object_ref(1),
    Output {
      address: Address(Script(test_client_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_client_output(datum: ClientDatum) -> Output {
  let token = test_client_token()
  Output {
    address: Address(Script(test_client_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn test_update_client_root(
  old_root: ByteArray,
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  client_state_siblings: List<ByteArray>,
) -> ByteArray {
  let client_state_key = client_keys.full_client_state_path("07-tendermint-0")
  ibc_state_commitment.apply_update(
    old_root,
    client_state_key,
    cbor.serialise(input_datum.state.client_state),
    cbor.serialise(output_datum.state.client_state),
    client_state_siblings,
  )
}

fn test_committed_client_root(
  input_datum: ClientDatum,
  client_state_siblings: List<ByteArray>,
) -> ByteArray {
  let client_state_key = client_keys.full_client_state_path("07-tendermint-0")
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    client_state_key,
    "",
    cbor.serialise(input_datum.state.client_state),
    client_state_siblings,
  )
}

fn test_connection_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock connection policy",
    name: auth.generate_token_name(
      base_token,
      connection_keys.connection_prefix,
      "0",
    ),
  }
}

fn test_connection_end(
  state: connection_state.State,
  seed: Int,
) -> ConnectionEnd {
  ConnectionEnd {
    client_id: "07-tendermint-0",
    versions: [Version { identifier: "1", features: ["ORDER_UNORDERED"] }],
    state,
    counterparty: connection_counterparty.Counterparty {
      client_id: "07-tendermint-1",
      connection_id: if state == connection_state.Init {
        ""
      } else {
        "connection-1"
      },
      prefix: MerklePrefix { key_prefix: "ibc" },
    },
    delay_period: positive_seed(seed % 10),
  }
}

fn test_connection_datum(
  state: connection_state.State,
  seed: Int,
) -> ConnectionDatum {
  ConnectionDatum {
    state: test_connection_end(state, seed),
    token: test_connection_token(),
    live_channel_count: 0,
    lifecycle: ConnectionActive,
  }
}

fn test_connection_input(datum: ConnectionDatum) -> Input {
  let token = test_connection_token()
  Input(
    test_object_ref(2),
    Output {
      address: Address(Script(test_connection_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_connection_output(datum: ConnectionDatum) -> Output {
  let token = test_connection_token()
  Output {
    address: Address(Script(test_connection_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn test_update_connection_root(
  old_root: ByteArray,
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
  connection_siblings: List<ByteArray>,
) -> ByteArray {
  let connection_key = host_connection_keys.connection_path("connection-0")
  ibc_state_commitment.apply_update(
    old_root,
    connection_key,
    cbor.serialise(input_datum.state),
    cbor.serialise(output_datum.state),
    connection_siblings,
  )
}

fn test_committed_connection_root(
  input_datum: ConnectionDatum,
  connection_siblings: List<ByteArray>,
) -> ByteArray {
  let connection_key = host_connection_keys.connection_path("connection-0")
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    connection_key,
    "",
    cbor.serialise(input_datum.state),
    connection_siblings,
  )
}

fn test_channel_datum_full(
  channel: Channel,
  next_sequence_send: Int,
  next_sequence_recv: Int,
  next_sequence_ack: Int,
  packet_commitment: Pairs<Int, ByteArray>,
  packet_receipt: Pairs<Int, ByteArray>,
  packet_acknowledgement: Pairs<Int, ByteArray>,
) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel,
      next_sequence_send,
      next_sequence_recv,
      next_sequence_ack,
      packet_commitment,
      packet_receipt,
      packet_acknowledgement,
      minimum_receive_proof_height: height_mod.zero_height(),
      maximum_receive_proof_height: height_mod.zero_height(),
    },
    port_id: "transfer",
    token: test_channel_token(),
    lifecycle: ChannelActive,
    voucher_supply: 0,
  }
}

fn with_maximum_receive_proof_height(
  datum: ChannelDatum,
  proof_height: Height,
) -> ChannelDatum {
  ChannelDatum {
    ..datum,
    state: ChannelDatumState {
      ..datum.state,
      maximum_receive_proof_height: proof_height,
    },
  }
}

fn test_channel_input_full(datum: ChannelDatum) -> Input {
  let token = test_channel_token()
  Input(
    test_object_ref(3),
    Output {
      address: Address(Script(test_channel_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_channel_output_full(datum: ChannelDatum) -> Output {
  let token = test_channel_token()
  Output {
    address: Address(Script(test_channel_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn channel_path() -> ByteArray {
  host_channel_keys.channel_path("transfer", "channel-0")
}

fn test_update_channel_root(
  old_root: ByteArray,
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  channel_siblings: List<ByteArray>,
) -> ByteArray {
  ibc_state_commitment.apply_update(
    old_root,
    channel_path(),
    cbor.serialise(input_datum.state.channel),
    cbor.serialise(output_datum.state.channel),
    channel_siblings,
  )
}

fn test_committed_channel_root(
  input_datum: ChannelDatum,
  channel_siblings: List<ByteArray>,
) -> ByteArray {
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    channel_path(),
    "",
    cbor.serialise(input_datum.state.channel),
    channel_siblings,
  )
}

fn test_committed_packet_root(
  sequence: Int,
  commitment: ByteArray,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    commitment_key,
    "",
    cbor.serialise(commitment),
    packet_commitment_siblings,
  )
}

fn handle_packet_redeemer(
  channel_siblings: List<ByteArray>,
  next_sequence_send_siblings: List<ByteArray>,
  next_sequence_recv_siblings: List<ByteArray>,
  next_sequence_ack_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
  packet_receipt_siblings: List<ByteArray>,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> HostStateRedeemer {
  HandlePacket {
    channel_siblings,
    next_sequence_send_siblings,
    next_sequence_recv_siblings,
    next_sequence_ack_siblings,
    packet_commitment_siblings,
    packet_receipt_siblings,
    packet_acknowledgement_siblings,
  }
}

fn test_handle_packet_send_root(
  old_root: ByteArray,
  sequence: Int,
  commitment: ByteArray,
  next_sequence_send_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let root_after_sequence =
    ibc_state_commitment.apply_update(
      old_root,
      next_sequence_send_key,
      cbor.serialise(sequence),
      cbor.serialise(sequence + 1),
      next_sequence_send_siblings,
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    root_after_sequence,
    commitment_key,
    "",
    cbor.serialise(commitment),
    packet_commitment_siblings,
  )
}

fn test_handle_packet_receipt_root(
  old_root: ByteArray,
  sequence: Int,
  packet_receipt_siblings: List<ByteArray>,
) -> ByteArray {
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    receipt_key,
    "",
    cbor.serialise(""),
    packet_receipt_siblings,
  )
}

fn test_handle_packet_acknowledgement_root(
  old_root: ByteArray,
  sequence: Int,
  acknowledgement: ByteArray,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> ByteArray {
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    acknowledgement_key,
    "",
    cbor.serialise(acknowledgement),
    packet_acknowledgement_siblings,
  )
}

fn test_handle_packet_commitment_delete_root(
  old_root: ByteArray,
  sequence: Int,
  commitment: ByteArray,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    commitment_key,
    cbor.serialise(commitment),
    "",
    packet_commitment_siblings,
  )
}

fn committed_client_leaves(
  datum: ClientDatum,
  live_connection_count: Int,
) -> Pairs<ByteArray, ByteArray> {
  let client_id = "07-tendermint-0"
  let latest_height = datum.state.client_state.latest_height
  expect Some(consensus_state) =
    pairs.get_first(datum.state.consensus_states, latest_height)
  [
    Pair(
      client_keys.full_client_state_path(client_id),
      cbor.serialise(datum.state.client_state),
    ),
    Pair(
      client_keys.full_client_consensus_state_path(
        client_id,
        string.from_int(latest_height.revision_height)
          |> string.to_bytearray(),
      ),
      cbor.serialise(consensus_state),
    ),
    Pair(
      reclamation.client_connection_count_path(client_id),
      reclamation.encode_count(live_connection_count),
    ),
  ]
}

test host_state_create_client_commits_state_consensus_and_zero_count() {
  let client_datum = test_client_datum(1, 0)
  let client_id = "07-tendermint-0"
  let client_state_key = client_keys.full_client_state_path(client_id)
  let consensus_key =
    client_keys.full_client_consensus_state_path(client_id, "1")
  let count_key = reclamation.client_connection_count_path(client_id)
  let client_state_value = cbor.serialise(client_datum.state.client_state)
  expect Some(consensus_state) =
    pairs.get_first(
      client_datum.state.consensus_states,
      client_datum.state.client_state.latest_height,
    )
  let consensus_value = cbor.serialise(consensus_state)
  let count_value = reclamation.encode_count(0)
  let client_state_siblings = sparse_siblings([], client_state_key)
  let consensus_state_siblings =
    sparse_siblings([Pair(client_state_key, client_state_value)], consensus_key)
  let client_connection_count_siblings =
    sparse_siblings(
      [
        Pair(client_state_key, client_state_value),
        Pair(consensus_key, consensus_value),
      ],
      count_key,
    )
  let new_root =
    sparse_root(
      [
        Pair(client_state_key, client_state_value),
        Pair(consensus_key, consensus_value), Pair(count_key, count_value),
      ],
    )
  let old_state = test_host_state(empty_ibc_state_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: 1,
      ibc_state_root: new_root,
      next_client_sequence: 1,
      live_client_count: 1,
    }

  spend_host_state(
    CreateClient {
      client_state_siblings,
      consensus_state_siblings,
      client_connection_count_siblings,
    },
    [test_host_input(old_state)],
    [test_host_output(new_state), test_client_output(client_datum)],
  )
}

test host_state_create_connection_updates_authenticated_client_count() {
  let client_datum = test_client_datum(1, 0)
  let connection_datum = test_connection_datum(connection_state.Init, 0)
  let old_leaves = committed_client_leaves(client_datum, 0)
  let connection_key = host_connection_keys.connection_path("connection-0")
  let connection_value = cbor.serialise(connection_datum.state)
  let count_key =
    reclamation.client_connection_count_path(connection_datum.state.client_id)
  let connection_siblings = sparse_siblings(old_leaves, connection_key)
  let leaves_after_connection =
    [Pair(connection_key, connection_value), ..old_leaves]
  let client_connection_count_siblings =
    sparse_siblings(leaves_after_connection, count_key)
  let new_leaves =
    [
      Pair(connection_key, connection_value),
      Pair(count_key, reclamation.encode_count(1)),
      ..list.filter(old_leaves, fn(pair) { pair.1st != count_key })
    ]
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: sparse_root(new_leaves),
      next_connection_sequence: 1,
      live_connection_count: 1,
    }

  spend_host_state(
    CreateConnection {
      connection_siblings,
      client_connection_count: 0,
      client_connection_count_siblings,
    },
    [test_host_input(old_state)],
    [test_host_output(new_state), test_connection_output(connection_datum)],
  )
}

test host_state_create_channel_cospends_and_increments_parent_connection() {
  let client_datum = test_client_datum(1, 0)
  let parent_input_datum = test_connection_datum(connection_state.Open, 0)
  let parent_output_datum =
    ConnectionDatum { ..parent_input_datum, live_channel_count: 1 }
  let channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Init),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let client_leaves = committed_client_leaves(client_datum, 1)
  let connection_key = host_connection_keys.connection_path("connection-0")
  let connection_value = cbor.serialise(parent_input_datum.state)
  let old_leaves = [Pair(connection_key, connection_value), ..client_leaves]
  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let send_key = packet_keys.next_sequence_send_path("transfer", "channel-0")
  let recv_key = packet_keys.next_sequence_recv_path("transfer", "channel-0")
  let ack_key = packet_keys.next_sequence_ack_path("transfer", "channel-0")
  let channel_value = cbor.serialise(channel_datum.state.channel)
  let send_value = cbor.serialise(channel_datum.state.next_sequence_send)
  let recv_value = cbor.serialise(channel_datum.state.next_sequence_recv)
  let ack_value = cbor.serialise(channel_datum.state.next_sequence_ack)
  let channel_siblings = sparse_siblings(old_leaves, channel_key)
  let after_channel = [Pair(channel_key, channel_value), ..old_leaves]
  let next_sequence_send_siblings = sparse_siblings(after_channel, send_key)
  let after_send = [Pair(send_key, send_value), ..after_channel]
  let next_sequence_recv_siblings = sparse_siblings(after_send, recv_key)
  let after_recv = [Pair(recv_key, recv_value), ..after_send]
  let next_sequence_ack_siblings = sparse_siblings(after_recv, ack_key)
  let new_leaves = [Pair(ack_key, ack_value), ..after_recv]
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      live_client_count: 1,
      live_connection_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: sparse_root(new_leaves),
      next_channel_sequence: 1,
      live_channel_count: 1,
    }

  spend_host_state(
    CreateChannel {
      channel_siblings,
      next_sequence_send_siblings,
      next_sequence_recv_siblings,
      next_sequence_ack_siblings,
    },
    [test_host_input(old_state), test_connection_input(parent_input_datum)],
    [
      test_host_output(new_state),
      test_connection_output(parent_output_datum),
      test_channel_output_full(channel_datum),
    ],
  )
}

fn host_state_prune_terminal_client_fixture(
  expected_client_policy: PolicyId,
) -> Bool {
  let latest_height = test_height(2)
  let old_height = test_height(1)
  let terminal_state =
    ClientState {
      ..test_client_state(latest_height),
      frozen_height: test_height(1),
    }
  let latest_consensus = test_consensus_state(2)
  let old_consensus = test_consensus_state(1)
  let input_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: terminal_state,
        consensus_states: [
          Pair(latest_height, latest_consensus), Pair(old_height, old_consensus),
        ],
        processed_times: [Pair(latest_height, 0), Pair(old_height, 0)],
        processed_heights: [Pair(latest_height, 0), Pair(old_height, 0)],
      },
      token: test_client_token(),
    }
  let output_datum =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        ..input_datum.state,
        consensus_states: [Pair(latest_height, latest_consensus)],
        processed_times: [Pair(latest_height, 0)],
        processed_heights: [Pair(latest_height, 0)],
      },
    }
  let client_id = "07-tendermint-0"
  let client_state_key = client_keys.full_client_state_path(client_id)
  let latest_key = client_keys.full_client_consensus_state_path(client_id, "2")
  let removed_key = client_keys.full_client_consensus_state_path(client_id, "1")
  let count_key = reclamation.client_connection_count_path(client_id)
  let retained_leaves =
    [
      Pair(client_state_key, cbor.serialise(terminal_state)),
      Pair(latest_key, cbor.serialise(latest_consensus)),
      Pair(count_key, reclamation.encode_count(0)),
    ]
  let old_leaves =
    [Pair(removed_key, cbor.serialise(old_consensus)), ..retained_leaves]
  let removed_siblings = sparse_siblings(old_leaves, removed_key)
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: sparse_root(retained_leaves),
    }

  spend_host_state_with_expected_policies(
    PruneTerminalClient { removed_consensus_state_siblings: [removed_siblings] },
    [test_host_input(old_state), test_client_input(input_datum)],
    [test_host_output(new_state), test_client_output(output_datum)],
    expected_client_policy,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
  )
}

test host_state_prunes_one_terminal_consensus_leaf_with_exact_witness() {
  host_state_prune_terminal_client_fixture(test_client_token().policy_id)
}

test host_state_prune_terminal_client_rejects_forged_client_policy() fail {
  host_state_prune_terminal_client_fixture(test_nft_policy())
}

// Precomputed 64-deep sparse-Merkle witnesses used by execution-budget tests.
// Keeping these literal prevents Aiken from charging sparse-tree fixture generation
// to the validator invocation being measured.
fn precomputed_create_connection_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"09abc2e7b78b48d1dd1ab17a10cf59578cd06ebd6183ca11b9fb8141b9e5ab12",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"eb9ee88449be1bdbfdeb0be436968b208337b0e444e43d91bcb1485db4f08009",
  ]
}

fn precomputed_create_connection_count_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"b7f6dd76c1d576260472167de8ccf39e3ffa4fb071170d0dfffc9c75c82fb2ee",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"eb9ee88449be1bdbfdeb0be436968b208337b0e444e43d91bcb1485db4f08009",
  ]
}

fn precomputed_prune_terminal_client_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"868f6c74bdbaad33fe48e30732039153f551f82242ffc72e1024d1fafab6e560",
  ]
}

fn precomputed_client_state_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"04d66659421ed3d78259bda0b1bd3d376eb46d90f6cf9d2b92876cd6d33e2e7a",
    #"ad68d32a6ec2f8d25e1e7b266908bc3acd5a146aa0d5210e5f4087c995bafeb7",
    #"0000000000000000000000000000000000000000000000000000000000000000",
  ]
}

fn precomputed_client_consensus_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"ad68d32a6ec2f8d25e1e7b266908bc3acd5a146aa0d5210e5f4087c995bafeb7",
    #"0000000000000000000000000000000000000000000000000000000000000000",
  ]
}

fn precomputed_client_count_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
  ]
}

fn precomputed_connection_state_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"37d55fec007dae18316d80363bc9daae9430152b60fed333557713b415de82ef",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"eb9ee88449be1bdbfdeb0be436968b208337b0e444e43d91bcb1485db4f08009",
  ]
}

fn precomputed_connection_count_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"eb9ee88449be1bdbfdeb0be436968b208337b0e444e43d91bcb1485db4f08009",
  ]
}

fn precomputed_channel_state_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"d93508eae2255e43854f24016e724dc5fddabf073bcbece6ee67747643dc7a7d",
    #"acc20ad8676d408b6ee1322c163f190cbe4c2b116f044f93517046a497f7ace6",
    #"61ee499e082e8375c9208fd5fbdf7381f467e48b96e6197f9f01b2c7413166b7",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"2a9b75a179a841fb02b5cebc3bfafbd901ca8b2fcd13ae7e08abe282ec746cbd",
  ]
}

fn precomputed_channel_send_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"facef664f757fa0e65d9dc437c7064e184513c251f7762d56ae15ed249a9fdad",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"9f5203f099b0abbca12ff0d8c77e3a31ee00dc4bac4d884bd03d2a09a71b536e",
  ]
}

fn precomputed_channel_recv_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"4fe52ed471a9b0d3e407b856ddfe092cc4e61ff53e0e52c6693c1f6cf1b49bba",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"9f5203f099b0abbca12ff0d8c77e3a31ee00dc4bac4d884bd03d2a09a71b536e",
  ]
}

fn precomputed_channel_ack_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"583057ddb0affa12f678445ba5d4439d3a06515006f2aac8936968a4d0b68117",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"e44fbb6ebdec987482d9ce12f29020ceb5159834f730c23e57dc8d812b6e9dfd",
    #"61ee499e082e8375c9208fd5fbdf7381f467e48b96e6197f9f01b2c7413166b7",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"eb9ee88449be1bdbfdeb0be436968b208337b0e444e43d91bcb1485db4f08009",
  ]
}

fn precomputed_closed_channel_send_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"facef664f757fa0e65d9dc437c7064e184513c251f7762d56ae15ed249a9fdad",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"dc12603b9b394d87d15cbd1aefc5514bf0b5b0c584e7b4aebfb44cf9a930425d",
  ]
}

fn precomputed_closed_channel_ack_siblings() -> List<ByteArray> {
  [
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"583057ddb0affa12f678445ba5d4439d3a06515006f2aac8936968a4d0b68117",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"0000000000000000000000000000000000000000000000000000000000000000",
    #"56b9476121d7a1c0adbc82abf7433e6dacc0ed3decdb824709d5e6d2cd329ef1",
    #"61ee499e082e8375c9208fd5fbdf7381f467e48b96e6197f9f01b2c7413166b7",
    #"ea8716675ccc092789fc660444d6b6202d68f60dbefe76570ae2f8c6d62b9121",
    #"2c5d1e53e541d75a74aa1ef2dc3e06e06f97362e7458dc76b96a92102d60047e",
  ]
}

fn host_state_reclaim_client_fixture(expected_client_policy: PolicyId) -> Bool {
  let latest_height = test_height(2)
  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: ClientState {
          ..test_client_state(latest_height),
          frozen_height: test_height(1),
        },
        consensus_states: [Pair(latest_height, test_consensus_state(2))],
        processed_times: [Pair(latest_height, 0)],
        processed_heights: [Pair(latest_height, 0)],
      },
      token: test_client_token(),
    }
  let old_leaves = committed_client_leaves(client_datum, 0)
  let client_state_key = client_keys.full_client_state_path("07-tendermint-0")
  let consensus_key =
    client_keys.full_client_consensus_state_path("07-tendermint-0", "2")
  let count_key = reclamation.client_connection_count_path("07-tendermint-0")
  let client_state_siblings = sparse_siblings(old_leaves, client_state_key)
  let after_client_state =
    list.filter(old_leaves, fn(pair) { pair.1st != client_state_key })
  let consensus_state_siblings =
    sparse_siblings(after_client_state, consensus_key)
  let after_consensus =
    list.filter(after_client_state, fn(pair) { pair.1st != consensus_key })
  let client_connection_count_siblings =
    sparse_siblings(after_consensus, count_key)
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: empty_ibc_state_root,
      live_client_count: 0,
    }

  spend_host_state_with_expected_policies(
    ReclaimClient {
      reclaim_to: trusted_deployer,
      client_state_siblings,
      consensus_state_siblings,
      client_connection_count_siblings,
    },
    [test_host_input(old_state), test_client_input(client_datum)],
    [test_host_output(new_state)],
    expected_client_policy,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
  )
}

test host_state_reclaims_final_client_and_zero_count_leaf() {
  host_state_reclaim_client_fixture(test_client_token().policy_id)
}

test host_state_reclaim_client_rejects_forged_client_policy() fail {
  host_state_reclaim_client_fixture(test_nft_policy())
}

fn host_state_reclaim_connection_fixture(
  expected_connection_policy: PolicyId,
) -> Bool {
  let client_datum = test_client_datum(1, 0)
  let connection_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Open, 0),
      lifecycle: Retiring { not_before: 0 },
    }
  let client_leaves = committed_client_leaves(client_datum, 1)
  let connection_key = host_connection_keys.connection_path("connection-0")
  let count_key =
    reclamation.client_connection_count_path(connection_datum.state.client_id)
  let old_leaves =
    [
      Pair(connection_key, cbor.serialise(connection_datum.state)),
      ..client_leaves
    ]
  let connection_siblings = sparse_siblings(old_leaves, connection_key)
  let after_connection =
    list.filter(old_leaves, fn(pair) { pair.1st != connection_key })
  let client_connection_count_siblings =
    sparse_siblings(after_connection, count_key)
  let new_leaves = committed_client_leaves(client_datum, 0)
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      live_client_count: 1,
      live_connection_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: sparse_root(new_leaves),
      live_connection_count: 0,
    }

  spend_host_state_with_expected_policies(
    ReclaimConnection {
      reclaim_to: trusted_deployer,
      connection_siblings,
      client_connection_count: 1,
      client_connection_count_siblings,
    },
    [test_host_input(old_state), test_connection_input(connection_datum)],
    [test_host_output(new_state)],
    test_client_token().policy_id,
    expected_connection_policy,
    test_channel_token().policy_id,
  )
}

test host_state_reclaims_connection_and_decrements_client_count_leaf() {
  host_state_reclaim_connection_fixture(test_connection_token().policy_id)
}

test host_state_reclaim_connection_rejects_forged_connection_policy() fail {
  host_state_reclaim_connection_fixture(test_nft_policy())
}

fn host_state_reclaim_abandoned_channel_fixture(
  expected_connection_policy: PolicyId,
  expected_channel_policy: PolicyId,
) -> Bool {
  let registration = test_module_registration(test_module_script_hash())
  let client_datum = test_client_datum(1, 0)
  let parent_input_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Open, 0),
      live_channel_count: 1,
      lifecycle: Retiring { not_before: 0 },
    }
  let parent_output_datum =
    ConnectionDatum { ..parent_input_datum, live_channel_count: 0 }
  let channel_datum =
    ChannelDatum {
      ..test_channel_datum_full(
        test_channel(channel_state.Init),
        1,
        1,
        1,
        [],
        [],
        [],
      ),
      lifecycle: Abandoning { not_before: 0 },
    }
  let connection_key = host_connection_keys.connection_path("connection-0")
  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let send_key = packet_keys.next_sequence_send_path("transfer", "channel-0")
  let recv_key = packet_keys.next_sequence_recv_path("transfer", "channel-0")
  let ack_key = packet_keys.next_sequence_ack_path("transfer", "channel-0")
  let retained_leaves =
    [
      Pair(connection_key, cbor.serialise(parent_input_datum.state)),
      Pair(port_commitment_key("transfer"), cbor.serialise(registration)),
      ..committed_client_leaves(client_datum, 1)
    ]
  let old_leaves =
    [
      Pair(channel_key, cbor.serialise(channel_datum.state.channel)),
      Pair(send_key, cbor.serialise(channel_datum.state.next_sequence_send)),
      Pair(recv_key, cbor.serialise(channel_datum.state.next_sequence_recv)),
      Pair(ack_key, cbor.serialise(channel_datum.state.next_sequence_ack)),
      ..retained_leaves
    ]
  let channel_siblings = sparse_siblings(old_leaves, channel_key)
  let after_channel =
    list.filter(old_leaves, fn(pair) { pair.1st != channel_key })
  let next_sequence_send_siblings = sparse_siblings(after_channel, send_key)
  let after_send = list.filter(after_channel, fn(pair) { pair.1st != send_key })
  let next_sequence_recv_siblings = sparse_siblings(after_send, recv_key)
  let after_recv = list.filter(after_send, fn(pair) { pair.1st != recv_key })
  let next_sequence_ack_siblings = sparse_siblings(after_recv, ack_key)
  let old_state =
    HostState {
      ..test_host_state(sparse_root(old_leaves), 0),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [Pair("transfer", registration)],
      live_client_count: 1,
      live_connection_count: 1,
      live_channel_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: sparse_root(retained_leaves),
      live_channel_count: 0,
    }
  let module_input =
    Input {
      output_reference: test_object_ref(4),
      output: test_module_output(registration),
    }
  let callback: Redeemer =
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: [],
      },
    )
  let host_redeemer =
    ReclaimChannel {
      reclaim_to: trusted_deployer,
      channel_siblings,
      next_sequence_send_siblings,
      next_sequence_recv_siblings,
      next_sequence_ack_siblings,
    }
  let transaction =
    with_lifecycle_marker(
      host_redeemer,
      Transaction {
        ..placeholder,
        inputs: [
          test_host_input(old_state),
          test_connection_input(parent_input_datum),
          test_channel_input_full(channel_datum),
          module_input,
        ],
        outputs: [
          test_host_output(new_state),
          test_connection_output(parent_output_datum),
        ],
        redeemers: [Pair(Spend(test_object_ref(4)), callback)],
      },
    )

  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      expected_connection_policy,
      expected_channel_policy,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      host_redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      host_redeemer,
      transaction,
      test_client_token().policy_id,
      expected_connection_policy,
      expected_channel_policy,
    ),
  }
}

test host_state_reclaims_abandoned_channel_and_decrements_parent_count() {
  host_state_reclaim_abandoned_channel_fixture(
    test_connection_token().policy_id,
    test_channel_token().policy_id,
  )
}

test host_state_reclaim_channel_rejects_forged_connection_policy() fail {
  host_state_reclaim_abandoned_channel_fixture(
    test_nft_policy(),
    test_channel_token().policy_id,
  )
}

test host_state_reclaim_channel_rejects_forged_channel_policy() fail {
  host_state_reclaim_abandoned_channel_fixture(
    test_connection_token().policy_id,
    test_nft_policy(),
  )
}

// These budget fixtures use literal roots and witnesses. Unlike the semantic
// tests above, their reported execution units exclude sparse-tree construction
// and therefore approximate the validator invocation charged on-chain.
test budget_precomputed_host_create_connection() {
  let host_token =
    AuthToken { policy_id: test_nft_policy(), name: host_state_token_name }
  let connection_token =
    AuthToken {
      policy_id: test_connection_token().policy_id,
      name: auth.generate_token_name(
        host_token,
        connection_keys.connection_prefix,
        "0",
      ),
    }
  let connection_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Init, 0),
      token: connection_token,
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"59324895e865b0341544e9ddb437d149db7ed7486cd55f43bfb465958083b1d5",
        0,
      ),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"3789751885eba884f89e904d2636265a74f42533cc91b64db7343f868b2d837b",
      next_connection_sequence: 1,
      live_connection_count: 1,
    }
  let host_redeemer: HostStateRedeemer =
    CreateConnection {
      connection_siblings: precomputed_create_connection_siblings(),
      client_connection_count: 0,
      client_connection_count_siblings: precomputed_create_connection_count_siblings(),
    }
  let object_mint_redeemer: Redeemer = connection_redeemer.ConnOpenInit
  let transaction =
    with_lifecycle_marker(
      host_redeemer,
      Transaction {
        ..placeholder,
        inputs: [test_host_input(old_state)],
        outputs: [
          test_host_output(new_state),
          Output {
            address: Address(Script(test_connection_script_hash()), None),
            value: from_asset(
              connection_token.policy_id,
              connection_token.name,
              1,
            ),
            datum: InlineDatum(connection_datum),
            reference_script: None,
          },
        ],
        mint: from_asset(connection_token.policy_id, connection_token.name, 1),
        redeemers: [
          Pair(Mint(connection_token.policy_id), object_mint_redeemer),
        ],
      },
    )

  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      connection_token.policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      host_redeemer,
      test_host_ref(),
      transaction,
    ),
    minting_lifecycle_creation_marker.mint_lifecycle_creation_marker.mint(
      test_nft_policy(),
      test_client_token().policy_id,
      connection_token.policy_id,
      test_channel_token().policy_id,
      AuthorizeCreation,
      test_lifecycle_creation_policy(),
      transaction,
    ),
  }
}

test budget_precomputed_host_prune_terminal_client() {
  let latest_height = test_height(2)
  let old_height = test_height(1)
  let terminal_state =
    ClientState {
      ..test_client_state(latest_height),
      frozen_height: test_height(1),
    }
  let latest_consensus = test_consensus_state(2)
  let old_consensus = test_consensus_state(1)
  let input_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: terminal_state,
        consensus_states: [
          Pair(latest_height, latest_consensus), Pair(old_height, old_consensus),
        ],
        processed_times: [Pair(latest_height, 0), Pair(old_height, 0)],
        processed_heights: [Pair(latest_height, 0), Pair(old_height, 0)],
      },
      token: test_client_token(),
    }
  let output_datum =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        ..input_datum.state,
        consensus_states: [Pair(latest_height, latest_consensus)],
        processed_times: [Pair(latest_height, 0)],
        processed_heights: [Pair(latest_height, 0)],
      },
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"d5058d4d8bdb0fe92991fc8f2122339ee40b780bb76c6cb9e43917671203e0c8",
        0,
      ),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"cf454a99b9f529a4de48575f016aa8f99935fa218628dd81422879794a4bdb7a",
    }

  spend_host_state_with_expected_policies(
    PruneTerminalClient {
      removed_consensus_state_siblings: [
        precomputed_prune_terminal_client_siblings(),
      ],
    },
    [test_host_input(old_state), test_client_input(input_datum)],
    [test_host_output(new_state), test_client_output(output_datum)],
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
  )
}

test budget_precomputed_host_reclaim_client() {
  let latest_height = test_height(2)
  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: ClientState {
          ..test_client_state(latest_height),
          frozen_height: test_height(1),
        },
        consensus_states: [Pair(latest_height, test_consensus_state(2))],
        processed_times: [Pair(latest_height, 0)],
        processed_heights: [Pair(latest_height, 0)],
      },
      token: test_client_token(),
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"cf454a99b9f529a4de48575f016aa8f99935fa218628dd81422879794a4bdb7a",
        0,
      ),
      next_client_sequence: 1,
      live_client_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      live_client_count: 0,
    }

  spend_host_state(
    ReclaimClient {
      reclaim_to: trusted_deployer,
      client_state_siblings: precomputed_client_state_siblings(),
      consensus_state_siblings: precomputed_client_consensus_siblings(),
      client_connection_count_siblings: precomputed_client_count_siblings(),
    },
    [test_host_input(old_state), test_client_input(client_datum)],
    [test_host_output(new_state)],
  )
}

test budget_precomputed_host_reclaim_connection() {
  let connection_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Open, 0),
      lifecycle: Retiring { not_before: 0 },
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"cb586f9140abbff64b822a6a4b8315a711fecfd8e01f69bf80d71d34916e9468",
        0,
      ),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      live_client_count: 1,
      live_connection_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"59324895e865b0341544e9ddb437d149db7ed7486cd55f43bfb465958083b1d5",
      live_connection_count: 0,
    }

  spend_host_state(
    ReclaimConnection {
      reclaim_to: trusted_deployer,
      connection_siblings: precomputed_connection_state_siblings(),
      client_connection_count: 1,
      client_connection_count_siblings: precomputed_connection_count_siblings(),
    },
    [test_host_input(old_state), test_connection_input(connection_datum)],
    [test_host_output(new_state)],
  )
}

test budget_precomputed_host_reclaim_abandoned_channel() {
  let registration = test_module_registration(test_module_script_hash())
  let parent_input_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Open, 0),
      live_channel_count: 1,
      lifecycle: Retiring { not_before: 0 },
    }
  let parent_output_datum =
    ConnectionDatum { ..parent_input_datum, live_channel_count: 0 }
  let channel_datum =
    ChannelDatum {
      ..test_channel_datum_full(
        test_channel(channel_state.Init),
        1,
        1,
        1,
        [],
        [],
        [],
      ),
      lifecycle: Abandoning { not_before: 0 },
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"13a90c0cdbf8338e82f8de38bafdda06034e130f042980e2a966db377b54c1a2",
        0,
      ),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [Pair("transfer", registration)],
      live_client_count: 1,
      live_connection_count: 1,
      live_channel_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"2bf2eae879d323ba1eb16ff541a78169e9607305aee88c2c35a2bd1c70f5233c",
      live_channel_count: 0,
    }
  let module_input =
    Input {
      output_reference: test_object_ref(4),
      output: test_module_output(registration),
    }
  let callback: Redeemer =
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: [],
      },
    )

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    ReclaimChannel {
      reclaim_to: trusted_deployer,
      channel_siblings: precomputed_channel_state_siblings(),
      next_sequence_send_siblings: precomputed_channel_send_siblings(),
      next_sequence_recv_siblings: precomputed_channel_recv_siblings(),
      next_sequence_ack_siblings: precomputed_channel_ack_siblings(),
    },
    test_host_ref(),
    with_policy_marker(
      test_lifecycle_reclamation_policy(),
      Transaction {
        ..placeholder,
        inputs: [
          test_host_input(old_state),
          test_connection_input(parent_input_datum),
          test_channel_input_full(channel_datum),
          module_input,
        ],
        outputs: [
          test_host_output(new_state),
          test_connection_output(parent_output_datum),
        ],
        redeemers: [Pair(Spend(test_object_ref(4)), callback)],
      },
    ),
  )
}

test budget_precomputed_host_reclaim_closed_channel() {
  let registration = test_module_registration(test_module_script_hash())
  let parent_input_datum =
    ConnectionDatum {
      ..test_connection_datum(connection_state.Open, 0),
      live_channel_count: 1,
      lifecycle: Retiring { not_before: 0 },
    }
  let parent_output_datum =
    ConnectionDatum { ..parent_input_datum, live_channel_count: 0 }
  let channel_datum =
    ChannelDatum {
      ..test_channel_datum_full(
        test_channel(channel_state.Closed),
        1,
        1,
        1,
        [],
        [],
        [],
      ),
      lifecycle: ChannelActive,
    }
  let old_state =
    HostState {
      ..test_host_state(
        #"1221ea273421aae0613f126723a14c20670902e8635f0592dc677d772145956b",
        0,
      ),
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [Pair("transfer", registration)],
      live_client_count: 1,
      live_connection_count: 1,
      live_channel_count: 1,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"64de0787d1439bd3882680be7185e498af8a5f3cf35aad66503acef1ce326c54",
      live_channel_count: 0,
    }
  let module_input =
    Input {
      output_reference: test_object_ref(4),
      output: test_module_output(registration),
    }
  let callback: Redeemer =
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: [],
      },
    )

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    ReclaimChannel {
      reclaim_to: trusted_deployer,
      channel_siblings: [],
      next_sequence_send_siblings: precomputed_closed_channel_send_siblings(),
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: precomputed_closed_channel_ack_siblings(),
    },
    test_host_ref(),
    with_policy_marker(
      test_lifecycle_reclamation_policy(),
      Transaction {
        ..placeholder,
        inputs: [
          test_host_input(old_state),
          test_connection_input(parent_input_datum),
          test_channel_input_full(channel_datum),
          module_input,
        ],
        outputs: [
          test_host_output(new_state),
          test_connection_output(parent_output_datum),
        ],
        redeemers: [Pair(Spend(test_object_ref(4)), callback)],
      },
    ),
  )
}

test prop_host_update_client_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_client.valid")

  // Positive root-transition case: the client datum change is committed into
  // the new HostState root with the same siblings supplied to the redeemer.
  let siblings = full_empty_siblings()
  let input_client_datum = test_misbehaviour_client_datum(seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let new_root =
    test_update_client_root(
      old_root,
      input_client_datum,
      output_client_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
      removed_consensus_state_siblings: [],
    }

  fuzz_dsl.valid_check(
    "host",
    "update_client",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [test_host_input(old_state), test_client_input(input_client_datum)],
      [test_host_output(new_state), test_client_output(output_client_datum)],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_update_client_rejects_wrong_root(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.update_client.invalid_wrong_root")

  // Near-valid mutation: the client datum changes, but HostState keeps the old
  // root. This proves object UTxOs cannot move without a matching root update.
  let siblings = full_empty_siblings()
  let input_client_datum = test_misbehaviour_client_datum(seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
      removed_consensus_state_siblings: [],
    }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_client_input(input_client_datum)],
    [test_host_output(new_state), test_client_output(output_client_datum)],
  )
}

test prop_host_update_client_rejects_wrong_redeemer(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.update_client.invalid_wrong_redeemer")

  // The root is correct for a client update, but the redeemer claims a
  // connection update. HostState must bind each state mutation to its operation.
  let siblings = full_empty_siblings()
  let input_client_datum = test_misbehaviour_client_datum(seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let new_root =
    test_update_client_root(
      old_root,
      input_client_datum,
      output_client_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_client_input(input_client_datum)],
    [test_host_output(new_state), test_client_output(output_client_datum)],
  )
}

fn validate_shutdown_update_client(valid_from: Int, valid_to: Int) -> Bool {
  // Keep the client active at both tested boundaries so rejection at the
  // cutoff can only come from the HostState shutdown rule.
  let seed = 600_000_000_000
  let grace_period_end = 600_001
  let siblings = full_empty_siblings()
  let input_client_datum = test_misbehaviour_client_datum(seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let new_root =
    test_update_client_root(
      old_root,
      input_client_datum,
      output_client_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let shutdown = ShuttingDown { initiated_at: -10, grace_period_end }
  let host_input =
    Input {
      output_reference: test_host_ref(),
      output: Output {
        address: Address(Script(test_host_script_hash()), None),
        value: from_asset(test_nft_policy(), host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            test_nft_policy(),
            shutdown,
          ),
        ),
        reference_script: None,
      },
    }
  let host_output =
    Output {
      ..host_input.output,
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(
          new_state,
          test_nft_policy(),
          shutdown,
        ),
      ),
    }
  let redeemer: HostStateRedeemer =
    UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
      removed_consensus_state_siblings: [],
    }
  let marked =
    with_lifecycle_marker(
      redeemer,
      Transaction {
        ..placeholder,
        inputs: [host_input, test_client_input(input_client_datum)],
        outputs: [host_output, test_client_output(output_client_datum)],
      },
    )
  let transaction =
    Transaction {
      ..marked,
      validity_range: interval.between(valid_from, valid_to),
    }

  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      redeemer,
      transaction,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
    ),
  }
}

test host_state_update_client_is_allowed_before_shutdown_cutoff() {
  validate_shutdown_update_client(0, 600_000)
}

test host_state_update_client_accepts_sixty_second_backdating_plus_ten_minutes() {
  validate_shutdown_update_client(-60_000, 600_000)
}

test host_state_update_client_is_rejected_at_shutdown_cutoff() fail {
  validate_shutdown_update_client(0, 600_001)
}

test prop_host_update_connection_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_connection.valid")

  let siblings = full_empty_siblings()
  let input_connection_datum =
    test_connection_datum(connection_state.Init, seed)
  let output_connection_datum =
    test_connection_datum(connection_state.Open, seed)
  let old_root =
    test_committed_connection_root(input_connection_datum, siblings)
  let new_root =
    test_update_connection_root(
      old_root,
      input_connection_datum,
      output_connection_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  fuzz_dsl.valid_check(
    "host",
    "update_connection",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [
        test_host_input(old_state),
        test_connection_input(input_connection_datum),
      ],
      [
        test_host_output(new_state),
        test_connection_output(output_connection_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

fn validate_operational_connection_marker(
  expected_policy: PolicyId,
  expected_script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
  duplicate_connection: Bool,
  extra_receipt: Bool,
) -> Bool {
  let siblings = full_empty_siblings()
  let input_datum = test_connection_datum(connection_state.Init, 0)
  let output_datum = test_connection_datum(connection_state.Open, 0)
  let old_root = test_committed_connection_root(input_datum, siblings)
  let new_root =
    test_update_connection_root(old_root, input_datum, output_datum, siblings)
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let host_redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }
  let connection_input = test_connection_input(input_datum)
  let connection_output = test_connection_output(output_datum)
  let marked =
    with_lifecycle_marker(
      host_redeemer,
      Transaction {
        ..placeholder,
        inputs: [test_host_input(old_state), connection_input],
        outputs: [test_host_output(new_state), connection_output],
      },
    )
  let duplicated =
    if duplicate_connection {
      Transaction {
        ..marked,
        inputs: [
          Input(test_object_ref(99), connection_input.output),
          ..marked.inputs
        ],
        outputs: [connection_output, ..marked.outputs],
      }
    } else {
      marked
    }
  let transaction =
    if extra_receipt {
      Transaction {
        ..duplicated,
        mint: duplicated.mint
          |> add(
              test_lifecycle_operational_policy(),
              lifecycle_marker_token_name,
              1,
            ),
        outputs: list.map(
          duplicated.outputs,
          fn(output) {
            if assets.has_nft(
              output.value,
              test_nft_policy(),
              host_state_token_name,
            ) {
              Output {
                ..output,
                value: output.value
                  |> add(
                      test_lifecycle_operational_policy(),
                      lifecycle_marker_token_name,
                      1,
                    ),
              }
            } else {
              output
            }
          },
        ),
      }
    } else {
      duplicated
    }

  minting_lifecycle_operational_marker.mint_lifecycle_operational_marker.mint(
    test_nft_policy(),
    test_client_script_hash(),
    expected_script_hash,
    test_channel_script_hash(),
    test_client_token().policy_id,
    expected_policy,
    test_channel_token().policy_id,
    AuthorizeOperation,
    test_lifecycle_operational_policy(),
    transaction,
  )
}

test lifecycle_operational_marker_rejects_forged_connection_policy() fail {
  validate_operational_connection_marker(
    test_nft_policy(),
    test_connection_script_hash(),
    False,
    False,
  )
}

test lifecycle_operational_marker_rejects_wrong_connection_script() fail {
  validate_operational_connection_marker(
    test_connection_token().policy_id,
    test_channel_script_hash(),
    False,
    False,
  )
}

test lifecycle_operational_marker_rejects_extra_canonical_connection_io() fail {
  validate_operational_connection_marker(
    test_connection_token().policy_id,
    test_connection_script_hash(),
    True,
    False,
  )
}

test lifecycle_operational_marker_rejects_non_singleton_receipt_mint() fail {
  validate_operational_connection_marker(
    test_connection_token().policy_id,
    test_connection_script_hash(),
    False,
    True,
  )
}

test prop_host_update_connection_rejects_uncommitted_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(
    @"fuzz.contract.host.update_connection.invalid_uncommitted_connection_change",
  )

  // The connection datum advances from Init to Open while the root is left
  // unchanged. That is exactly the uncommitted-state mutation HostState guards.
  let siblings = full_empty_siblings()
  let input_connection_datum =
    test_connection_datum(connection_state.Init, seed)
  let output_connection_datum =
    test_connection_datum(connection_state.Open, seed)
  let old_root =
    test_committed_connection_root(input_connection_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_connection_input(input_connection_datum)],
    [
      test_host_output(new_state),
      test_connection_output(output_connection_datum),
    ],
  )
}

test prop_host_update_channel_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_channel.valid")

  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Init), 1, [])
  let output_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let new_root =
    test_update_channel_root(
      old_root,
      input_channel_datum,
      output_channel_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings: siblings }

  fuzz_dsl.valid_check(
    "host",
    "update_channel",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_update_channel_rejects_packet_field_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.update_channel.invalid_packet_field_change")

  // UpdateChannel may change channel state, but packet fields are owned by
  // HandlePacket. Mutating sequence/commitment here must be rejected.
  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let output_channel_datum =
    test_channel_datum(
      test_channel(channel_state.Open),
      2,
      [Pair(1, #"010203")],
    )
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_update_channel_rejects_receive_height_mutation(
  seed via fuzz.int(),
) fail {
  fuzz.label(
    @"fuzz.contract.host.update_channel.invalid_receive_height_mutation",
  )

  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        minimum_receive_proof_height: test_height(10),
        maximum_receive_proof_height: test_height(11),
      },
    }
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }

  spend_host_state(
    UpdateChannel { channel_siblings: siblings },
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_accepts_send(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_send")

  // SendPacket creates a packet commitment, so the new root must commit exactly
  // that packet key/value and the channel datum must record the same sequence.
  let sequence = test_sequence(seed)
  let packet = test_packet(sequence)
  let siblings = full_empty_siblings()
  let commitment = packet_mod.commit_packet(packet)
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      next_sequence_send_key,
      "",
      cbor.serialise(sequence),
      siblings,
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  let commitment_siblings =
    siblings_after_single_insert(
      next_sequence_send_key,
      cbor.serialise(sequence + 1),
      commitment_key,
    )
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence + 1,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let new_root =
    test_handle_packet_send_root(
      old_root,
      sequence,
      commitment,
      siblings,
      commitment_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_send",
    "spend_host_state",
    spend_host_state_with_channel_redeemer(
      handle_packet_redeemer([], siblings, [], [], commitment_siblings, [], []),
      SendPacket { packet },
      test_channel_input_full(input_channel_datum),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

fn validate_packet_marker_voucher_supply_guard(
  voucher_delta: Int,
  voucher_action: Bool,
) -> Bool {
  let sequence = 1
  let packet = test_packet(sequence)
  let siblings = full_empty_siblings()
  let commitment = packet_mod.commit_packet(packet)
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      next_sequence_send_key,
      "",
      cbor.serialise(sequence),
      siblings,
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  let commitment_siblings =
    siblings_after_single_insert(
      next_sequence_send_key,
      cbor.serialise(sequence + 1),
      commitment_key,
    )
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    ChannelDatum {
      ..test_channel_datum_full(
        test_channel(channel_state.Open),
        sequence + 1,
        1,
        1,
        [Pair(sequence, commitment)],
        [],
        [],
      ),
      voucher_supply: input_channel_datum.voucher_supply + voucher_delta,
    }
  let new_root =
    test_handle_packet_send_root(
      old_root,
      sequence,
      commitment,
      siblings,
      commitment_siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer_and_voucher_action(
    handle_packet_redeemer([], siblings, [], [], commitment_siblings, [], []),
    SendPacket { packet },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
    voucher_action,
  )
}

test packet_marker_rejects_channel_voucher_supply_change_without_voucher_action() fail {
  validate_packet_marker_voucher_supply_guard(1, False)
}

test packet_marker_allows_channel_voucher_supply_change_with_voucher_action() {
  validate_packet_marker_voucher_supply_guard(1, True)
}

test prop_host_handle_packet_accepts_recv(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_recv")

  let sequence = test_sequence(seed)
  let packet = test_packet(sequence)
  let acknowledgement_commitment = #"010203"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    with_maximum_receive_proof_height(
      test_channel_datum_full(
        test_channel(channel_state.Open),
        1,
        1,
        1,
        [],
        [Pair(sequence, "")],
        [Pair(sequence, acknowledgement_commitment)],
      ),
      test_height(1),
    )
  let root_after_receipt =
    test_handle_packet_receipt_root(old_root, sequence, siblings)
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      root_after_receipt,
      acknowledgement_key,
      "",
      cbor.serialise(acknowledgement_commitment),
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_recv",
    "spend_host_state",
    spend_host_state_with_channel_redeemer(
      handle_packet_redeemer(
        [],
        [],
        [],
        [],
        [],
        siblings,
        acknowledgement_siblings,
      ),
      RecvPacket {
        packet,
        proof_commitment: empty_proof(),
        proof_height: test_height(1),
      },
      test_channel_input_full(input_channel_datum),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test host_state_handle_packet_recv_succeeds_at_history_capacity() {
  let sequence = max_packet_entries_per_channel - 1
  let packet = test_packet(sequence)
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, sequence - 1, "")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      [],
    )
  let output_channel_datum =
    with_maximum_receive_proof_height(
      test_channel_datum_full(
        test_channel(channel_state.Open),
        1,
        1,
        1,
        [],
        [Pair(sequence, ""), ..existing_receipts],
        [Pair(sequence, acknowledgement)],
      ),
      test_height(1),
    )
  let root_after_receipt =
    test_handle_packet_receipt_root(old_root, sequence, siblings)
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      root_after_receipt,
      sequence,
      acknowledgement,
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer(
      [],
      [],
      [],
      [],
      [],
      siblings,
      acknowledgement_siblings,
    ),
    RecvPacket {
      packet,
      proof_commitment: empty_proof(),
      proof_height: test_height(1),
    },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_history_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_history_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let packet = test_packet(sequence)
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [Pair(sequence, ""), ..existing_receipts],
      pairs.insert_by_ascending_key(
        existing_acknowledgements,
        sequence,
        acknowledgement,
        int.compare,
      ),
    )
  let root_after_receipt =
    test_handle_packet_receipt_root(old_root, sequence, siblings)
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      root_after_receipt,
      sequence,
      acknowledgement,
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer(
      [],
      [],
      [],
      [],
      [],
      siblings,
      acknowledgement_siblings,
    ),
    RecvPacket {
      packet,
      proof_commitment: empty_proof(),
      proof_height: test_height(1),
    },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test host_state_handle_packet_acknowledgement_succeeds_at_history_capacity() {
  let sequence = max_packet_entries_per_channel - 1
  let packet = test_packet(sequence)
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_acknowledgements =
    packet_entries(1, sequence - 1, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      existing_acknowledgements,
    )
  let output_channel_datum =
    with_maximum_receive_proof_height(
      test_channel_datum_full(
        test_channel(channel_state.Open),
        1,
        1,
        1,
        [],
        [Pair(sequence, "")],
        pairs.insert_by_ascending_key(
          existing_acknowledgements,
          sequence,
          acknowledgement,
          int.compare,
        ),
      ),
      test_height(1),
    )
  let root_after_receipt =
    test_handle_packet_receipt_root(old_root, sequence, siblings)
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      root_after_receipt,
      sequence,
      acknowledgement,
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer(
      [],
      [],
      [],
      [],
      [],
      siblings,
      acknowledgement_siblings,
    ),
    RecvPacket {
      packet,
      proof_commitment: empty_proof(),
      proof_height: test_height(1),
    },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_acknowledgement_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_ack_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let packet = test_packet(sequence)
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity - 1, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [Pair(sequence, ""), ..existing_receipts],
      pairs.insert_by_ascending_key(
        existing_acknowledgements,
        sequence,
        acknowledgement,
        int.compare,
      ),
    )
  let root_after_receipt =
    test_handle_packet_receipt_root(old_root, sequence, siblings)
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      root_after_receipt,
      sequence,
      acknowledgement,
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer(
      [],
      [],
      [],
      [],
      [],
      siblings,
      acknowledgement_siblings,
    ),
    RecvPacket {
      packet,
      proof_commitment: empty_proof(),
      proof_height: test_height(1),
    },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test host_state_handle_packet_send_succeeds_at_commitment_capacity() {
  let sequence = max_packet_entries_per_channel
  let packet = test_packet(sequence)
  let commitment = packet_mod.commit_packet(packet)
  let siblings = full_empty_siblings()
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      next_sequence_send_key,
      "",
      cbor.serialise(sequence),
      siblings,
    )
  let existing_commitments =
    packet_entries(1, sequence - 1, "existing commitment")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      existing_commitments,
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence + 1,
      1,
      1,
      pairs.insert_by_ascending_key(
        existing_commitments,
        sequence,
        commitment,
        int.compare,
      ),
      [],
      [],
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  let commitment_siblings =
    siblings_after_single_insert(
      next_sequence_send_key,
      cbor.serialise(sequence + 1),
      commitment_key,
    )
  let new_root =
    test_handle_packet_send_root(
      old_root,
      sequence,
      commitment,
      siblings,
      commitment_siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer([], siblings, [], [], commitment_siblings, [], []),
    SendPacket { packet },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_commitment_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_commitment_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let packet = test_packet(sequence)
  let commitment = packet_mod.commit_packet(packet)
  let siblings = full_empty_siblings()
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      next_sequence_send_key,
      "",
      cbor.serialise(sequence),
      siblings,
    )
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence + 1,
      1,
      1,
      [Pair(sequence, commitment)],
      existing_receipts,
      existing_acknowledgements,
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  let commitment_siblings =
    siblings_after_single_insert(
      next_sequence_send_key,
      cbor.serialise(sequence + 1),
      commitment_key,
    )
  let new_root =
    test_handle_packet_send_root(
      old_root,
      sequence,
      commitment,
      siblings,
      commitment_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer([], siblings, [], [], commitment_siblings, [], []),
    SendPacket { packet },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_recv_with_unrelated_channel_mutation(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_recv_channel_mutation")

  // A receive may only write its ordered sequence/receipt and acknowledgement.
  // Rebinding the counterparty in the same HostState update must be rejected.
  let sequence = test_sequence(seed)
  let packet = test_packet(sequence)
  let acknowledgement_commitment = #"010203"
  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let mutated_channel =
    Channel {
      ..input_channel_datum.state.channel,
      counterparty: ChannelCounterparty {
        ..input_channel_datum.state.channel.counterparty,
        channel_id: "channel-evil",
      },
    }
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        channel: mutated_channel,
        packet_receipt: [Pair(sequence, "")],
        packet_acknowledgement: [Pair(sequence, acknowledgement_commitment)],
      },
    }
  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let old_channel_value = cbor.serialise(input_channel_datum.state.channel)
  let new_channel_value = cbor.serialise(mutated_channel)
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      old_channel_value,
      siblings,
    )
  let root_after_channel =
    ibc_state_commitment.apply_update(
      old_root,
      channel_key,
      old_channel_value,
      new_channel_value,
      siblings,
    )
  let receipt_siblings =
    siblings_after_single_insert(channel_key, new_channel_value, receipt_key)
  let root_after_receipt =
    ibc_state_commitment.apply_update(
      root_after_channel,
      receipt_key,
      "",
      cbor.serialise(""),
      receipt_siblings,
    )
  let acknowledgement_siblings =
    siblings_after_two_inserts(
      channel_key,
      new_channel_value,
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      root_after_receipt,
      acknowledgement_key,
      "",
      cbor.serialise(acknowledgement_commitment),
      acknowledgement_siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state_with_channel_redeemer(
    handle_packet_redeemer(
      siblings,
      [],
      [],
      [],
      [],
      receipt_siblings,
      acknowledgement_siblings,
    ),
    RecvPacket {
      packet,
      proof_commitment: empty_proof(),
      proof_height: test_height(1),
    },
    test_channel_input_full(input_channel_datum),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_accepts_ack(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_ack")

  let sequence = test_sequence(seed)
  let packet = test_packet(sequence)
  let siblings = full_empty_siblings()
  let commitment = packet_mod.commit_packet(packet)
  let old_root = test_committed_packet_root(sequence, commitment, siblings)
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let new_root =
    test_handle_packet_commitment_delete_root(
      old_root,
      sequence,
      commitment,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_ack",
    "spend_host_state",
    spend_host_state_with_channel_redeemer(
      handle_packet_redeemer([], [], [], [], siblings, [], []),
      AcknowledgePacket {
        packet,
        acknowledgement: "acknowledgement",
        proof_acked: empty_proof(),
        proof_height: test_height(1),
      },
      test_channel_input_full(input_channel_datum),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_handle_packet_accepts_timeout(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_timeout")

  let sequence = test_sequence(seed)
  let packet = test_packet(sequence)
  let siblings = full_empty_siblings()
  let commitment = packet_mod.commit_packet(packet)
  let old_root = test_committed_packet_root(sequence, commitment, siblings)
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let new_root =
    test_handle_packet_commitment_delete_root(
      old_root,
      sequence,
      commitment,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_timeout",
    "spend_host_state",
    spend_host_state_with_channel_redeemer(
      handle_packet_redeemer([], [], [], [], siblings, [], []),
      TimeoutPacket {
        packet,
        proof_unreceived: empty_proof(),
        proof_height: test_height(1),
        next_sequence_recv: 1,
      },
      test_channel_input_full(input_channel_datum),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_handle_packet_rejects_channel_only_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_channel_only_change")

  // HandlePacket cannot be used as a generic channel-state updater. Closing the
  // channel with packet redeemer shape should fail even with a consistent root.
  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let output_channel_datum =
    test_channel_datum(test_channel(channel_state.Closed), 1, [])
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let new_root =
    test_update_channel_root(
      old_root,
      input_channel_datum,
      output_channel_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer(siblings, [], [], [], [], [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_wrong_packet_key(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_wrong_packet_key")

  // The channel datum records the expected commitment, but the HostState root is
  // built for a different packet key. This catches key/path drift in packets.
  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let commitment = #"010203"
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let wrong_root =
    test_handle_packet_send_root(
      old_root,
      sequence + 1,
      commitment,
      siblings,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: wrong_root,
    }

  spend_host_state(
    handle_packet_redeemer([], siblings, [], [], siblings, [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

fn check_host_prune_packet_history(
  use_wrong_ack_witness: Bool,
  at_capacity: Bool,
) -> Bool {
  let sequence =
    if at_capacity {
      max_packet_entries_per_channel / 2
    } else {
      7
    }
  let acknowledgement = "acknowledgement commitment"
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  let empty_siblings = full_empty_siblings()
  let acknowledgement_insert_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let root_after_receipt_insert =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      receipt_key,
      "",
      cbor.serialise(""),
      empty_siblings,
    )
  let old_root =
    ibc_state_commitment.apply_update(
      root_after_receipt_insert,
      acknowledgement_key,
      "",
      cbor.serialise(acknowledgement),
      acknowledgement_insert_siblings,
    )
  let receipt_delete_siblings =
    siblings_after_single_insert(
      acknowledgement_key,
      cbor.serialise(acknowledgement),
      receipt_key,
    )
  let root_after_receipt_delete =
    ibc_state_commitment.apply_update(
      old_root,
      receipt_key,
      cbor.serialise(""),
      "",
      receipt_delete_siblings,
    )
  let expected_new_root =
    ibc_state_commitment.apply_update(
      root_after_receipt_delete,
      acknowledgement_key,
      cbor.serialise(acknowledgement),
      "",
      empty_siblings,
    )

  let receipt_entries =
    if at_capacity {
      packet_entries(1, sequence, "")
    } else {
      [Pair(sequence, "")]
    }
  let acknowledgement_entries =
    if at_capacity {
      packet_entries(1, sequence, acknowledgement)
    } else {
      [Pair(sequence, acknowledgement)]
    }
  expect
    if at_capacity {
      list.length(receipt_entries) + list.length(acknowledgement_entries) == max_packet_entries_per_channel
    } else {
      True
    }
  let base_input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      receipt_entries,
      acknowledgement_entries,
    )
  let input_channel_datum =
    ChannelDatum {
      ..base_input_channel_datum,
      state: ChannelDatumState {
        ..base_input_channel_datum.state,
        maximum_receive_proof_height: test_height(10),
      },
    }
  let proof_height = test_height(12)
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: pairs.delete_first(receipt_entries, sequence),
        packet_acknowledgement: pairs.delete_first(
          acknowledgement_entries,
          sequence,
        ),
        minimum_receive_proof_height: proof_height,
      },
    }
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: expected_new_root,
    }
  let acknowledgement_delete_siblings =
    if use_wrong_ack_witness {
      receipt_delete_siblings
    } else {
      empty_siblings
    }
  let host_redeemer: HostStateRedeemer =
    HandlePacket {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: receipt_delete_siblings,
      packet_acknowledgement_siblings: acknowledgement_delete_siblings,
    }
  let channel_redeemer: SpendChannelRedeemer =
    PruneChannelPacketHistory {
      sequence,
      proof_commitment_absence: empty_proof(),
      proof_height,
    }
  let channel_input = test_channel_input_full(input_channel_datum)

  spend_host_state_with_channel_redeemer(
    host_redeemer,
    channel_redeemer,
    channel_input,
    [test_host_input(old_state), channel_input],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test host_state_prune_packet_history_deletes_receipt_then_ack_root() {
  check_host_prune_packet_history(False, False)
}

test host_state_prune_packet_history_succeeds_at_full_packet_history_capacity() {
  check_host_prune_packet_history(False, True)
}

test host_state_prune_packet_history_rejects_wrong_post_receipt_ack_witness() fail {
  check_host_prune_packet_history(True, False)
}

test prop_host_bind_port_rejects_missing_authority(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.bind_port.invalid_unauthorized")

  let port_id = test_port_id(positive_seed(seed % 1000))
  spend_test_bind_port([], [port_id], port_id, [])
}

test prop_host_bind_port_rejects_global_overflow(seed via fuzz.int()) {
  fuzz.label(@"fuzz.unit.host.bind_port.invalid_capacity")

  expect max_bound_ports == 10
  let port_id = test_port_id(10 + positive_seed(seed % 1000))
  fuzz_dsl.mutated_check(
    "host",
    "bind_port",
    "global_capacity",
    "host_state.validate_bind_port",
    test_bind_port_transition(
      [
        "port-0", "port-1", "port-2", "port-3", "port-4", "port-5", "port-6",
        "port-7", "port-8", "port-9",
      ],
      [
        "port-0", "port-1", "port-2", "port-3", "port-4", "port-5", "port-6",
        "port-7", "port-8", "port-9", port_id,
      ],
      port_id,
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test host_state_bind_port_rejects_duplicate_textual_id() fail {
  test_bind_port_transition(["transfer"], ["transfer"], "transfer")
}

test host_state_bind_port_rejects_reserved_retirement_marker() fail {
  let marker = retired_port_marker("transfer")
  test_bind_port_transition([], [marker], marker)
}

test host_state_bind_port_rejects_invalid_textual_identifier() fail {
  test_bind_port_transition([], ["bad/port"], "bad/port")
}

test host_state_bind_port_uses_canonical_cbor_bytearray_order() {
  // Canonical CBOR orders byte-string map keys by encoded length first, then
  // lexicographically. This is the order emitted by Lucid for the deployment's
  // mixed-length port IDs.
  test_bind_port_transition(
    ["mock", "transfer"],
    ["mock", "icqhost", "transfer"],
    "icqhost",
  )
}

test prop_host_bind_port_rejects_too_short_textual_identifier(
  seed via fuzz.int(),
) {
  fuzz.label(@"fuzz.unit.host.bind_port.invalid_identifier")

  let port_id =
    if seed % 2 == 0 {
      "a"
    } else {
      "b"
    }
  fuzz_dsl.mutated_check(
    "host",
    "bind_port",
    "identifier_length",
    "host_state.validate_bind_port",
    test_bind_port_transition([], [port_id], port_id),
  )
    |> fuzz_dsl.assert_rejected
}

/// This is the maximum-size HostState port-list transition permitted by the
/// protocol and is also collected by the transaction-budget CI job.
test host_state_bind_tenth_port_succeeds_at_global_cap() {
  expect max_bound_ports == 10
  spend_test_bind_port(
    [
      "port-0", "port-1", "port-2", "port-3", "port-4", "port-5", "port-6",
      "port-7", "port-8",
    ],
    [
      "port-0", "port-1", "port-2", "port-3", "port-4", "port-5", "port-6",
      "port-7", "port-8", "port-9",
    ],
    "port-9",
    [trusted_deployer],
  )
}

test host_state_bind_port_succeeds_with_correct_root_witness() {
  // -------------------------------------------------------------------------
  // Arrange: a starting HostState UTxO with an empty commitment root.
  // -------------------------------------------------------------------------
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

  // These parameters are required by the validator type, but BindPort does not
  // use them. We still provide valid-looking script hashes.
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let old_datum = test_host_state_datum(old_state, nft_policy)

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  // -------------------------------------------------------------------------
  // Arrange: the updated HostState UTxO after binding one port.
  // -------------------------------------------------------------------------
  let port_id = "mock"
  let registration = test_module_registration(test_module_script_hash())

  // For an empty tree, every sibling hash along the path is the empty hash.
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port_id)
  let port_value = cbor.serialise(registration)

  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [Pair(port_id, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1)
        |> add(
            test_lifecycle_operational_policy(),
            lifecycle_marker_token_name,
            1,
          ),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // -------------------------------------------------------------------------
  // Act: evaluate the HostState STT validator for BindPort.
  // -------------------------------------------------------------------------
  let redeemer: HostStateRedeemer =
    BindPort { port_id, registration, port_siblings }

  let host_redeemer_data: Redeemer = redeemer
  let marker_redeemer_data: Redeemer = AuthorizeOperation
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [
        host_output,
        Output {
          ..test_module_output(registration),
          // Module datums are application-owned; transfer initializes its
          // escrow-shard registry here when binding the port.
          datum: InlineDatum(#"00"),
        },
      ],
      mint: from_asset(
        test_lifecycle_operational_policy(),
        lifecycle_marker_token_name,
        1,
      ),
      redeemers: [
        Pair(Spend(input_ref), host_redeemer_data),
        Pair(Mint(test_lifecycle_operational_policy()), marker_redeemer_data),
      ],
      extra_signatories: [trusted_deployer],
    }

  and {
    host_state_stt.host_state_stt.spend(
      nft_policy,
      dummy_script_hash,
      dummy_script_hash,
      dummy_script_hash,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      redeemer,
      input_ref,
      transaction,
    ),
    minting_lifecycle_operational_marker.mint_lifecycle_operational_marker.mint(
      nft_policy,
      dummy_script_hash,
      dummy_script_hash,
      dummy_script_hash,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      AuthorizeOperation,
      test_lifecycle_operational_policy(),
      transaction,
    ),
  }
}

test host_state_bind_port_fails_with_arbitrary_root() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let old_datum = test_host_state_datum(old_state, nft_policy)

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port_id = "mock"
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  // Intentionally set the new root to an arbitrary value (the old root).
  // The validator must reject this because the witness implies a different root.
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: empty_ibc_state_root,
      bound_port: [Pair(port_id, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer =
    BindPort { port_id, registration, port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_cannot_move_nft_to_different_address() fail {
  // Arrange: a valid HostState input at the HostState script address.
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

  let original_address = Address(Script(dummy_script_hash), None)

  let moved_address =
    Address(
      Script(#"00000000000000000000000000000000000000000000000000000000"),
      None,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let old_datum = test_host_state_datum(old_state, nft_policy)

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: original_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  // Arrange: a valid state transition (BindPort) that would succeed, except the
  // output tries to move the NFT to a different address.
  let port_id = "mock"
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port_id)
  let port_value = cbor.serialise(registration)

  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [Pair(port_id, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address: moved_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer =
    BindPort { port_id, registration, port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_bind_port_fails_without_required_sibling_hashes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let old_datum = test_host_state_datum(old_state, nft_policy)

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port_id = "mock"
  let registration = test_module_registration(test_module_script_hash())

  // Compute the correct new root (still using the full witness list) so that the
  // only mismatch is the missing witness carried in the redeemer.
  let full_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port_id)
  let port_value = cbor.serialise(registration)
  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      full_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [Pair(port_id, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // Pass an empty witness list. The validator expects exactly `merkle_depth_bits`
  // hashes, so this must fail.
  let redeemer: HostStateRedeemer =
    BindPort { port_id, registration, port_siblings: [] }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_bind_port_fails_if_output_missing() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let old_datum = test_host_state_datum(old_state, nft_policy)

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port_id = "mock"
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let redeemer: HostStateRedeemer =
    BindPort { port_id, registration, port_siblings }

  // No HostState output is produced, so the STT validator must fail.
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [],
      extra_signatories: [trusted_deployer],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_enter_shutdown_succeeds_with_deployer_signature() {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let address = Address(Script(host_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 1000,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: 2000,
    }

  let grace_period_end = 5000
  let target_root =
    #"1111111111111111111111111111111111111111111111111111111111111111"
  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }
  let old_datum =
    HostStateDatum {
      ..test_host_state_datum(old_state, nft_policy),
      live_reference_script_count: Some(3),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(
        ReferenceScriptRegistration {
          target_count: 3,
          target_root,
          last_out_ref: test_object_ref(3),
        },
      ),
    }
  let new_datum =
    HostStateDatum {
      ..test_host_state_datum_with_shutdown(
        new_state,
        nft_policy,
        ShuttingDown {
          initiated_at: new_state.last_update_time,
          grace_period_end,
        },
      ),
      live_reference_script_count: Some(3),
      reference_script_inventory_root: target_root,
      reference_script_registration: Some(
        ReferenceScriptRegistration {
          target_count: 3,
          target_root,
          last_out_ref: test_object_ref(3),
        },
      ),
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.between(1_000, 2_000),
    }

  let redeemer: HostStateRedeemer = EnterShutdown { grace_period_end }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_enter_shutdown_fails_without_deployer_signature() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let address = Address(Script(host_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 1000,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: 2000,
    }

  let grace_period_end = 5000
  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(
          new_state,
          nft_policy,
          ShuttingDown {
            initiated_at: new_state.last_update_time,
            grace_period_end,
          },
        ),
      ),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
      validity_range: interval.between(1_000, 2_000),
    }

  let redeemer: HostStateRedeemer = EnterShutdown { grace_period_end }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_legacy_finalize_shutdown_is_rejected_after_grace_period() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let host_address = Address(Script(host_script_hash), None)
  let reclaimed_address = Address(Script(dummy_script_hash), None)
  let grace_period_end = 5000

  let old_state =
    HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2000,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            nft_policy,
            ShuttingDown {
              initiated_at: old_state.last_update_time,
              grace_period_end,
            },
          ),
        ),
        reference_script: None,
      },
    )

  let reclaimed_output =
    Output {
      address: reclaimed_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [reclaimed_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end),
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    FinalizeShutdown,
    input_ref,
    transaction,
  )
}

test host_state_finalize_shutdown_fails_before_grace_period() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let host_address = Address(Script(host_script_hash), None)
  let reclaimed_address = Address(Script(dummy_script_hash), None)
  let grace_period_end = 5000

  let old_state =
    HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2000,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            nft_policy,
            ShuttingDown {
              initiated_at: old_state.last_update_time,
              grace_period_end,
            },
          ),
        ),
        reference_script: None,
      },
    )

  let reclaimed_output =
    Output {
      address: reclaimed_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [reclaimed_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end - 1),
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    FinalizeShutdown,
    input_ref,
    transaction,
  )
}

fn validate_seal_shutdown_fixture(
  live_client_count: Int,
  bound_port: Pairs<ByteArray, ModuleRegistration>,
  valid_from: Int,
  valid_to: Int,
  sealed_at: Int,
) -> Bool {
  let grace_period_end = 5_000
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      version: 1,
      last_update_time: 2_000,
      live_client_count,
      bound_port,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: sealed_at,
    }
  let old_datum =
    test_host_state_datum_with_shutdown(
      old_state,
      test_nft_policy(),
      ShuttingDown {
        initiated_at: old_state.last_update_time,
        grace_period_end,
      },
    )
  let new_datum =
    test_host_state_datum_with_shutdown(
      new_state,
      test_nft_policy(),
      Sealed {
        sealed_at,
        proof_window_end: reclamation.proof_window_end(sealed_at),
      },
    )
  let host_input =
    Input {
      output_reference: test_host_ref(),
      output: Output {
        address: Address(Script(test_host_script_hash()), None),
        value: from_asset(test_nft_policy(), host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    }
  let host_output =
    Output { ..host_input.output, datum: InlineDatum(new_datum) }

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    SealShutdown,
    test_host_ref(),
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.between(valid_from, valid_to),
    },
  )
}

test host_state_seals_fully_drained_shutdown_for_fixed_proof_window() {
  let valid_from = 5_000
  let valid_to = valid_from + validator_utils.max_lifecycle_validity_width
  validate_seal_shutdown_fixture(0, [], valid_from, valid_to, valid_to)
}

test host_state_seal_rejects_remaining_live_objects() fail {
  validate_seal_shutdown_fixture(1, [], 5_000, 6_000, 6_000)
}

test host_state_seal_rejects_a_lower_bound_backdated_timestamp() fail {
  validate_seal_shutdown_fixture(0, [], 5_000, 6_000, 5_000)
}

test host_state_seal_rejects_a_validity_interval_starting_before_grace() fail {
  validate_seal_shutdown_fixture(0, [], 4_999, 5_999, 5_999)
}

test host_state_seal_rejects_a_wide_validity_interval() fail {
  let valid_from = 5_000
  let valid_to = valid_from + validator_utils.max_lifecycle_validity_width + 1
  validate_seal_shutdown_fixture(0, [], valid_from, valid_to, valid_to)
}

type ReclaimModuleFixture {
  ReclaimModuleFixture {
    shutdown: ShutdownState,
    module_redeemer: IBCModuleRedeemer,
    include_module: Bool,
    include_deployer: Bool,
    live_client_count: Int,
    live_connection_count: Int,
    live_channel_count: Int,
    requested_port_id: ByteArray,
    output_port_id: ByteArray,
    mutate_root: Bool,
    mutate_sequence: Bool,
    mutate_count: Bool,
    advance_time: Bool,
  }
}

fn valid_reclaim_module_fixture() -> ReclaimModuleFixture {
  ReclaimModuleFixture {
    shutdown: ShuttingDown { initiated_at: 1_000, grace_period_end: 5_000 },
    module_redeemer: Callback(OnHostStateSeal),
    include_module: True,
    include_deployer: True,
    live_client_count: 0,
    live_connection_count: 0,
    live_channel_count: 0,
    requested_port_id: "transfer",
    output_port_id: retired_port_marker("transfer"),
    mutate_root: False,
    mutate_sequence: False,
    mutate_count: False,
    advance_time: True,
  }
}

fn validate_reclaim_module_fixture(fixture: ReclaimModuleFixture) -> Bool {
  let registration = test_module_registration(test_module_script_hash())
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      version: 1,
      bound_port: [Pair("transfer", registration)],
      last_update_time: 2_000,
      live_client_count: fixture.live_client_count,
      live_connection_count: fixture.live_connection_count,
      live_channel_count: fixture.live_channel_count,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: if fixture.mutate_root {
        #"1111111111111111111111111111111111111111111111111111111111111111"
      } else {
        old_state.ibc_state_root
      },
      next_client_sequence: if fixture.mutate_sequence {
        old_state.next_client_sequence + 1
      } else {
        old_state.next_client_sequence
      },
      bound_port: [Pair(fixture.output_port_id, registration)],
      last_update_time: if fixture.advance_time {
        old_state.last_update_time + 1
      } else {
        old_state.last_update_time
      },
      live_client_count: if fixture.mutate_count {
        old_state.live_client_count + 1
      } else {
        old_state.live_client_count
      },
    }
  let old_datum =
    test_host_state_datum_with_shutdown(
      old_state,
      test_nft_policy(),
      fixture.shutdown,
    )
  let new_datum =
    test_host_state_datum_with_shutdown(
      new_state,
      test_nft_policy(),
      fixture.shutdown,
    )
  let host_input =
    Input {
      output_reference: test_host_ref(),
      output: Output {
        address: Address(Script(test_host_script_hash()), None),
        value: from_asset(test_nft_policy(), host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    }
  let host_output =
    Output { ..host_input.output, datum: InlineDatum(new_datum) }
  let module_input =
    Input(test_object_ref(92), test_module_output(registration))
  let module_redeemer_data: Redeemer = fixture.module_redeemer
  let host_redeemer = ReclaimModule { port_id: fixture.requested_port_id }
  let transaction =
    with_lifecycle_marker(
      host_redeemer,
      Transaction {
        ..placeholder,
        inputs: if fixture.include_module {
          [host_input, module_input]
        } else {
          [host_input]
        },
        outputs: [host_output],
        extra_signatories: if fixture.include_deployer {
          [trusted_deployer]
        } else {
          []
        },
        redeemers: if fixture.include_module {
          [Pair(Spend(module_input.output_reference), module_redeemer_data)]
        } else {
          []
        },
      },
    )

  and {
    host_state_stt.host_state_stt.spend(
      test_nft_policy(),
      test_client_script_hash(),
      test_connection_script_hash(),
      test_channel_script_hash(),
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
      test_lifecycle_creation_policy(),
      test_lifecycle_reclamation_policy(),
      test_lifecycle_operational_policy(),
      test_lifecycle_packet_policy(),
      test_reference_script_hash(),
      None,
      host_redeemer,
      test_host_ref(),
      transaction,
    ),
    validate_delegated_marker(
      host_redeemer,
      transaction,
      test_client_token().policy_id,
      test_connection_token().policy_id,
      test_channel_token().policy_id,
    ),
  }
}

test host_state_reclaim_module_accepts_drained_shutdown_and_terminal_callback() {
  validate_reclaim_module_fixture(valid_reclaim_module_fixture())
}

test host_state_reclaim_module_rejects_omitted_registered_module_root() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      include_module: False,
    },
  )
}

test host_state_reclaim_module_rejects_wrong_registered_module_callback() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      module_redeemer: Callback(
        OnChanReclaim {
          channel_id: "channel-0",
          channel_live_escrow_shard_count_siblings: [],
        },
      ),
    },
  )
}

test host_state_reclaim_module_rejects_missing_deployer_signature() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      include_deployer: False,
    },
  )
}

test host_state_reclaim_module_rejects_active_host() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture { ..valid_reclaim_module_fixture(), shutdown: Active },
  )
}

test host_state_reclaim_module_rejects_sealed_host() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      shutdown: Sealed { sealed_at: 2_000, proof_window_end: 3_000 },
    },
  )
}

test host_state_reclaim_module_rejects_live_client() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      live_client_count: 1,
    },
  )
}

test host_state_reclaim_module_rejects_live_connection() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      live_connection_count: 1,
    },
  )
}

test host_state_reclaim_module_rejects_live_channel() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      live_channel_count: 1,
    },
  )
}

test host_state_reclaim_module_rejects_unregistered_port() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      requested_port_id: "mock",
    },
  )
}

test host_state_reclaim_module_rejects_noncanonical_marker_replacement() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      output_port_id: "transfer",
    },
  )
}

test host_state_reclaim_module_rejects_wrong_marker_replacement() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      output_port_id: retired_port_marker("mock"),
    },
  )
}

test host_state_reclaim_module_rejects_root_mutation() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture { ..valid_reclaim_module_fixture(), mutate_root: True },
  )
}

test host_state_reclaim_module_rejects_sequence_mutation() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      mutate_sequence: True,
    },
  )
}

test host_state_reclaim_module_rejects_count_mutation() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      mutate_count: True,
    },
  )
}

test host_state_reclaim_module_rejects_stale_timestamp() fail {
  validate_reclaim_module_fixture(
    ReclaimModuleFixture {
      ..valid_reclaim_module_fixture(),
      advance_time: False,
    },
  )
}

test host_state_seal_accepts_retired_registration_markers() {
  let registration = test_module_registration(test_module_script_hash())
  validate_seal_shutdown_fixture(
    0,
    [Pair(retired_port_marker("transfer"), registration)],
    5_000,
    6_000,
    6_000,
  )
}

test host_state_seal_rejects_active_registration() fail {
  let registration = test_module_registration(test_module_script_hash())
  validate_seal_shutdown_fixture(
    0,
    [Pair("transfer", registration)],
    5_000,
    6_000,
    6_000,
  )
}

test host_state_seal_rejects_malformed_retired_registration_marker() fail {
  let registration = test_module_registration(test_module_script_hash())
  validate_seal_shutdown_fixture(
    0,
    [Pair(retired_port_marker("bad/port"), registration)],
    5_000,
    6_000,
    6_000,
  )
}

fn validate_update_module_state_fixture(
  old_shutdown: ShutdownState,
  new_shutdown: ShutdownState,
  module_redeemer: IBCModuleRedeemer,
  include_module: Bool,
  use_registered_module: Bool,
  mutate_root: Bool,
  mutate_count: Bool,
  advance_time: Bool,
  requested_port_id: ByteArray,
) -> Bool {
  let port_id = "transfer"
  let registration = test_module_registration(test_module_script_hash())
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 100),
      version: 4,
      bound_port: [Pair(port_id, registration)],
      last_update_time: 100,
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: if mutate_root {
        #"1111111111111111111111111111111111111111111111111111111111111111"
      } else {
        old_state.ibc_state_root
      },
      last_update_time: if advance_time {
        old_state.last_update_time + 1
      } else {
        old_state.last_update_time
      },
      live_client_count: if mutate_count {
        old_state.live_client_count + 1
      } else {
        old_state.live_client_count
      },
    }
  let host_input =
    Input {
      output_reference: test_host_ref(),
      output: Output {
        address: Address(Script(test_host_script_hash()), None),
        value: from_asset(test_nft_policy(), host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            test_nft_policy(),
            old_shutdown,
          ),
        ),
        reference_script: None,
      },
    }
  let host_output =
    Output {
      ..host_input.output,
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(
          new_state,
          test_nft_policy(),
          new_shutdown,
        ),
      ),
    }
  let actual_registration =
    if use_registered_module {
      registration
    } else {
      test_module_registration(
        #"815f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b378",
      )
    }
  let module_input =
    Input(test_object_ref(91), test_module_output(actual_registration))
  let module_redeemer_data: Redeemer = module_redeemer

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    UpdateModuleState { port_id: requested_port_id },
    test_host_ref(),
    Transaction {
      ..placeholder,
      inputs: if include_module {
        [host_input, module_input]
      } else {
        [host_input]
      },
      outputs: [host_output],
      redeemers: if include_module {
        [Pair(Spend(module_input.output_reference), module_redeemer_data)]
      } else {
        []
      },
    },
  )
}

fn module_operator_redeemer() -> IBCModuleRedeemer {
  Operator(OtherModuleOperator)
}

test host_state_update_module_state_accepts_active_operator() {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_accepts_shutting_down_operator() {
  let shutdown = ShuttingDown { initiated_at: 50, grace_period_end: 500 }
  validate_update_module_state_fixture(
    shutdown,
    shutdown,
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_missing_registered_input() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    False,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_wrong_module_script() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    False,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_unregistered_port() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    True,
    "mock",
  )
}

test host_state_update_module_state_rejects_callback() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: [],
      },
    ),
    True,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_root_mutation() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    True,
    True,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_count_mutation() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    True,
    False,
    True,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_shutdown_mutation() fail {
  validate_update_module_state_fixture(
    Active,
    ShuttingDown { initiated_at: 101, grace_period_end: 500 },
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

test host_state_update_module_state_rejects_stale_timestamp() fail {
  validate_update_module_state_fixture(
    Active,
    Active,
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    False,
    "transfer",
  )
}

test host_state_update_module_state_rejects_sealed() fail {
  let shutdown = Sealed { sealed_at: 50, proof_window_end: 500 }
  validate_update_module_state_fixture(
    shutdown,
    shutdown,
    module_operator_redeemer(),
    True,
    True,
    False,
    False,
    True,
    "transfer",
  )
}

fn validate_final_host_reclaim(
  valid_from: Int,
  mix_capability_tokens_into_payout: Bool,
) -> Bool {
  let sealed_at = 5_000
  let proof_window_end = reclamation.proof_window_end(sealed_at)
  let state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      version: 2,
      last_update_time: sealed_at,
    }
  let terminal_identity = inventory_host_reference_identity()
  let terminal_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [terminal_identity],
    )
  let datum =
    HostStateDatum {
      ..test_host_state_datum_with_shutdown(
        state,
        test_nft_policy(),
        Sealed { sealed_at, proof_window_end },
      ),
      live_reference_script_count: Some(1),
      reference_script_inventory_root: terminal_root,
      reference_script_registration: Some(
        ReferenceScriptRegistration {
          target_count: 1,
          target_root: terminal_root,
          last_out_ref: terminal_identity.output_reference,
        },
      ),
    }
  let host_input =
    Input {
      output_reference: test_host_ref(),
      output: Output {
        address: Address(Script(test_host_script_hash()), None),
        value: assets.from_lovelace(2_000_000)
          |> add(test_nft_policy(), host_state_token_name, 1),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  let payout_value =
    if mix_capability_tokens_into_payout {
      let registration = test_module_registration(test_module_script_hash())
      assets.from_lovelace(2_000_000)
        |> add(
            registration.port_token.policy_id,
            registration.port_token.name,
            1,
          )
        |> add(
            registration.module_token.policy_id,
            registration.module_token.name,
            1,
          )
    } else {
      assets.from_lovelace(2_000_000)
    }

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    ReclaimHostState { reclaim_to: trusted_deployer },
    test_host_ref(),
    Transaction {
      ..placeholder,
      inputs: [host_input, inventory_host_reference_input()],
      outputs: [
        Output {
          address: from_verification_key(trusted_deployer),
          value: payout_value,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint: from_asset(test_nft_policy(), host_state_token_name, -1),
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(valid_from),
    },
  )
}

test host_state_final_reclaim_burns_sealed_anchor_after_proof_window() {
  validate_final_host_reclaim(reclamation.proof_window_end(5_000), False)
}

test host_state_final_reclaim_rejects_before_proof_window() fail {
  validate_final_host_reclaim(reclamation.proof_window_end(5_000) - 1, False)
}

test host_state_final_reclaim_rejects_capability_payout_ada_double_counting() fail {
  validate_final_host_reclaim(reclamation.proof_window_end(5_000), True)
}

test host_state_update_channel_rejects_packet_field_changes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let channel_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"

  let channel_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])

  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let channel_value = cbor.serialise(input_channel_datum.state.channel)
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      channel_value,
      channel_siblings,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: old_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }

  let host_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_address = Address(Script(host_script_hash), None)
  let host_input =
    Input(
      host_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(new_state, nft_policy)),
      reference_script: None,
    }

  let output_channel_datum =
    test_channel_datum(
      test_channel(channel_state.Open),
      2,
      [Pair(1, #"010203")],
    )

  let channel_token = test_channel_token()
  let channel_input =
    Input(
      OutputReference {
        transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
        output_index: 0,
      },
      Output {
        address: Address(Script(channel_script_hash), None),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    )

  let channel_output =
    Output {
      address: Address(Script(channel_script_hash), None),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(output_channel_datum),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input, channel_input],
      outputs: [host_output, channel_output],
    }

  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    host_script_hash,
    host_script_hash,
    channel_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    host_ref,
    transaction,
  )
}

test host_state_handle_packet_rejects_channel_only_changes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let channel_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"

  let channel_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let input_channel = test_channel(channel_state.Open)
  let output_channel = test_channel(channel_state.Closed)
  let input_channel_datum = test_channel_datum(input_channel, 1, [])
  let output_channel_datum = test_channel_datum(output_channel, 1, [])

  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      cbor.serialise(input_channel),
      channel_siblings,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      old_root,
      channel_key,
      cbor.serialise(input_channel),
      cbor.serialise(output_channel),
      channel_siblings,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: old_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  let host_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_address = Address(Script(host_script_hash), None)
  let host_input =
    Input(
      host_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(new_state, nft_policy)),
      reference_script: None,
    }

  let channel_token = test_channel_token()
  let channel_input =
    Input(
      OutputReference {
        transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
        output_index: 0,
      },
      Output {
        address: Address(Script(channel_script_hash), None),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    )

  let channel_output =
    Output {
      address: Address(Script(channel_script_hash), None),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(output_channel_datum),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input, channel_input],
      outputs: [host_output, channel_output],
    }

  let redeemer: HostStateRedeemer =
    HandlePacket {
      channel_siblings,
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    host_script_hash,
    host_script_hash,
    channel_script_hash,
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    host_ref,
    transaction,
  )
}

test host_state_heartbeat_preserves_ibc_state() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_first() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state), ..test_unrelated_outputs(8)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_middle() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let outputs =
    list.concat(
      test_unrelated_outputs(4),
      [test_host_output(new_state), ..test_unrelated_outputs(4)],
    )

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    outputs,
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_last() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let outputs =
    list.concat(test_unrelated_outputs(8), [test_host_output(new_state)])

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    outputs,
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_duplicate_host_outputs() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let host_output = test_host_output(new_state)

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [host_output, host_output],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_unauthorized_signer() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
  )
}

test host_state_heartbeat_rejects_root_change() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"22",
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_counter_change() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      next_client_sequence: old_state.next_client_sequence + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_stale_timestamp() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state = HostState { ..old_state, version: old_state.version + 1 }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_shutdown_state() fail {
  let nft_policy = test_nft_policy()
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let shutdown =
    ShuttingDown {
      initiated_at: old_state.last_update_time,
      grace_period_end: old_state.last_update_time + 1000,
    }
  let address = Address(Script(test_host_script_hash()), None)
  let host_input =
    Input(
      test_host_ref(),
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(old_state, nft_policy, shutdown),
        ),
        reference_script: None,
      },
    )
  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(new_state, nft_policy, shutdown),
      ),
      reference_script: None,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [host_input],
    [host_output],
    [trusted_deployer],
  )
}

fn inventory_datum(
  count: Option<Int>,
  shutdown: ShutdownState,
  version: Int,
) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: version,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    },
    nft_policy: test_nft_policy(),
    deployer: trusted_deployer,
    shutdown,
    live_reference_script_count: count,
    reference_script_inventory_root: empty_reference_script_inventory_root,
    reference_script_registration: None,
  }
}

fn inventory_host_input(datum: HostStateDatum) -> Input {
  Input(
    test_host_ref(),
    Output {
      address: Address(Script(test_host_script_hash()), None),
      value: from_asset(test_nft_policy(), host_state_token_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn inventory_host_output(datum: HostStateDatum) -> Output {
  Output { ..inventory_host_input(datum).output, datum: InlineDatum(datum) }
}

fn inventory_reference_input(
  index: Int,
  script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
  has_reference_script: Bool,
) -> Input {
  Input(
    test_object_ref(index),
    Output {
      address: Address(Script(script_hash), None),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: if has_reference_script {
        Some(script_hash)
      } else {
        None
      },
    },
  )
}

fn inventory_reference_input_with_script_hash(
  index: Int,
  reference_script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
) -> Input {
  let input =
    inventory_reference_input(index, test_reference_script_hash(), True)
  Input {
    ..input,
    output: Output {
      ..input.output,
      reference_script: Some(reference_script_hash),
    },
  }
}

fn spend_inventory_transition(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  redeemer: HostStateRedeemer,
  reference_inputs: List<Input>,
  ordinary_reference_script_inputs: List<Input>,
  extra_outputs: List<Output>,
  signers: List<crypto.VerificationKeyHash>,
  valid_from: Int,
) -> Bool {
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [
        inventory_host_input(old_datum),
        ..ordinary_reference_script_inputs
      ],
      reference_inputs,
      outputs: [inventory_host_output(new_datum), ..extra_outputs],
      extra_signatories: signers,
      validity_range: interval.after(valid_from),
    }

  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    test_client_token().policy_id,
    test_connection_token().policy_id,
    test_channel_token().policy_id,
    test_lifecycle_creation_policy(),
    test_lifecycle_reclamation_policy(),
    test_lifecycle_operational_policy(),
    test_lifecycle_packet_policy(),
    test_reference_script_hash(),
    None,
    redeemer,
    test_host_ref(),
    transaction,
  )
}

fn inventory_identity(
  index: Int,
  script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
) -> ReferenceScriptIdentity {
  ReferenceScriptIdentity {
    output_reference: test_object_ref(index),
    reference_script_hash: script_hash,
  }
}

fn inventory_host_reference_identity() -> ReferenceScriptIdentity {
  inventory_identity(9, test_host_script_hash())
}

fn inventory_host_reference_input() -> Input {
  inventory_reference_input_with_script_hash(9, test_host_script_hash())
}

fn register_reference_scripts(
  target_count: Int,
  target_root: ByteArray,
  batch_out_refs: List<OutputReference>,
) -> HostStateRedeemer {
  RegisterReferenceScripts { target_count, target_root, batch_out_refs }
}

fn registered_inventory_datum(
  count: Int,
  current_root: ByteArray,
  target_count: Int,
  target_root: ByteArray,
  last_out_ref: OutputReference,
  shutdown: ShutdownState,
  version: Int,
) -> HostStateDatum {
  HostStateDatum {
    ..inventory_datum(Some(count), shutdown, version),
    reference_script_inventory_root: current_root,
    reference_script_registration: Some(
      ReferenceScriptRegistration { target_count, target_root, last_out_ref },
    ),
  }
}

test host_state_registers_reference_inventory_in_safe_batches_then_finalizes() {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let id_3 = inventory_identity(3, test_reference_script_hash())
  let first_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      first_root,
      [id_2, id_3],
    )
  let target_count = 4
  let initial = inventory_datum(None, Active, 0)
  let first_batch =
    registered_inventory_datum(
      -2,
      first_root,
      target_count,
      target_root,
      test_object_ref(1),
      Active,
      1,
    )
  let complete =
    registered_inventory_datum(
      -4,
      target_root,
      target_count,
      target_root,
      test_object_ref(3),
      Active,
      2,
    )
  let finalized =
    registered_inventory_datum(
      4,
      target_root,
      target_count,
      target_root,
      test_object_ref(3),
      Active,
      3,
    )

  and {
    spend_inventory_transition(
      initial,
      first_batch,
      register_reference_scripts(
        target_count,
        target_root,
        [test_object_ref(9), test_object_ref(1)],
      ),
      [
        inventory_reference_input(1, test_reference_script_hash(), True),
        inventory_host_reference_input(),
      ],
      [],
      [],
      [trusted_deployer],
      0,
    ),
    spend_inventory_transition(
      first_batch,
      complete,
      register_reference_scripts(
        target_count,
        target_root,
        [test_object_ref(2), test_object_ref(3)],
      ),
      [
        inventory_reference_input(3, test_reference_script_hash(), True),
        inventory_host_reference_input(),
        inventory_reference_input(2, test_reference_script_hash(), True),
      ],
      [],
      [],
      [trusted_deployer],
      0,
    ),
    spend_inventory_transition(
      complete,
      finalized,
      FinalizeReferenceScriptRegistration,
      [inventory_host_reference_input()],
      [],
      [],
      [trusted_deployer],
      0,
    ),
  }
}

test host_state_registration_rejects_early_finalize() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let first_root =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  let target_root = append_reference_script_identities(first_root, [id_2])
  let partial =
    registered_inventory_datum(
      -1,
      first_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    )
  let forged_final =
    registered_inventory_datum(
      1,
      first_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      2,
    )
  spend_inventory_transition(
    partial,
    forged_final,
    FinalizeReferenceScriptRegistration,
    [],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_a_forged_batch_count() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -3,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_non_script_or_wrong_validator_inputs() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), False),
      inventory_reference_input(2, test_module_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_duplicate_batch_outrefs() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1), test_object_ref(1)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_a_missing_selected_witness() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1)],
    ),
    [inventory_host_reference_input()],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_an_unselected_extra_witness() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
      inventory_reference_input(2, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_requires_host_first_and_a_non_host_tail() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(1), test_object_ref(9)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_a_host_only_first_batch() fail {
  let host_id = inventory_host_reference_identity()
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -1,
      target_root,
      1,
      target_root,
      test_object_ref(9),
      Active,
      1,
    ),
    register_reference_scripts(1, target_root, [test_object_ref(9)]),
    [inventory_host_reference_input()],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_rejects_a_lower_outref_in_a_later_batch() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let first_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_2],
    )
  let target_root = append_reference_script_identities(first_root, [id_1])
  let partial =
    registered_inventory_datum(
      -2,
      first_root,
      3,
      target_root,
      test_object_ref(2),
      Active,
      1,
    )
  let forged_complete =
    registered_inventory_datum(
      -3,
      target_root,
      3,
      target_root,
      test_object_ref(1),
      Active,
      2,
    )
  spend_inventory_transition(
    partial,
    forged_complete,
    register_reference_scripts(3, target_root, [test_object_ref(1)]),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_registration_requires_the_deployer_signature() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  spend_inventory_transition(
    inventory_datum(None, Active, 0),
    registered_inventory_datum(
      -2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    register_reference_scripts(
      2,
      target_root,
      [test_object_ref(9), test_object_ref(1)],
    ),
    [
      inventory_host_reference_input(),
      inventory_reference_input(1, test_reference_script_hash(), True),
    ],
    [],
    [],
    [],
    0,
  )
}

test host_state_registration_cannot_resume_after_finalization() fail {
  let host_id = inventory_host_reference_identity()
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let target_root =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id, id_1],
    )
  let forged_root = append_reference_script_identities(target_root, [id_2])
  spend_inventory_transition(
    registered_inventory_datum(
      2,
      target_root,
      2,
      target_root,
      test_object_ref(1),
      Active,
      1,
    ),
    registered_inventory_datum(
      3,
      forged_root,
      2,
      target_root,
      test_object_ref(2),
      Active,
      2,
    ),
    register_reference_scripts(2, target_root, [test_object_ref(2)]),
    [
      inventory_host_reference_input(),
      inventory_reference_input(2, test_reference_script_hash(), True),
    ],
    [],
    [],
    [trusted_deployer],
    0,
  )
}

test host_state_reference_reclaim_reserves_the_host_for_atomic_finalization() {
  let host_id = inventory_host_reference_identity()
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let id_3 = inventory_identity(3, test_reference_script_hash())
  let root_after_first =
    host_state.fold_reference_script_identities_in_order(
      empty_reference_script_inventory_root,
      [host_id],
    )
  let target_root =
    append_reference_script_identities(root_after_first, [id_2, id_3])
  let shutdown = Sealed { sealed_at: 1_000, proof_window_end: 2_000 }
  let old =
    registered_inventory_datum(
      3,
      target_root,
      3,
      target_root,
      test_object_ref(3),
      shutdown,
      3,
    )
  let intermediate =
    registered_inventory_datum(
      1,
      root_after_first,
      3,
      target_root,
      test_object_ref(3),
      shutdown,
      4,
    )
  let final =
    registered_inventory_datum(
      0,
      empty_reference_script_inventory_root,
      3,
      target_root,
      test_object_ref(3),
      shutdown,
      5,
    )
  and {
    spend_inventory_transition(
      old,
      intermediate,
      ReclaimReferenceScripts { predecessor_root: root_after_first },
      [],
      [
        inventory_reference_input(3, test_reference_script_hash(), True),
        inventory_reference_input(2, test_reference_script_hash(), True),
      ],
      [],
      [trusted_deployer],
      2_000,
    ),
    !spend_inventory_transition(
      intermediate,
      final,
      ReclaimReferenceScripts {
        predecessor_root: empty_reference_script_inventory_root,
      },
      [],
      [inventory_host_reference_input()],
      [],
      [trusted_deployer],
      2_000,
    ),
  }
}

fn validate_bad_reference_suffix(
  inputs: List<Input>,
  predecessor_root: ByteArray,
) -> Bool {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let id_3 = inventory_identity(3, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  let target_root =
    append_reference_script_identities(root_after_first, [id_2, id_3])
  let shutdown = Sealed { sealed_at: 1_000, proof_window_end: 2_000 }
  spend_inventory_transition(
    registered_inventory_datum(
      3,
      target_root,
      3,
      target_root,
      test_object_ref(3),
      shutdown,
      3,
    ),
    registered_inventory_datum(
      1,
      predecessor_root,
      3,
      target_root,
      test_object_ref(3),
      shutdown,
      4,
    ),
    ReclaimReferenceScripts { predecessor_root },
    [],
    inputs,
    [],
    [trusted_deployer],
    2_000,
  )
}

test host_state_reference_reclaim_rejects_wrong_outref() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  validate_bad_reference_suffix(
    [
      inventory_reference_input(2, test_reference_script_hash(), True),
      inventory_reference_input(4, test_reference_script_hash(), True),
    ],
    root_after_first,
  )
}

test host_state_reference_reclaim_rejects_wrong_script_hash() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  validate_bad_reference_suffix(
    [
      inventory_reference_input(2, test_reference_script_hash(), True),
      inventory_reference_input_with_script_hash(3, test_module_script_hash()),
    ],
    root_after_first,
  )
}

test host_state_reference_reclaim_rejects_omitted_input() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  validate_bad_reference_suffix(
    [inventory_reference_input(2, test_reference_script_hash(), True)],
    root_after_first,
  )
}

test host_state_reference_reclaim_rejects_extra_input() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  validate_bad_reference_suffix(
    [
      inventory_reference_input(2, test_reference_script_hash(), True),
      inventory_reference_input(3, test_reference_script_hash(), True),
      inventory_reference_input(4, test_reference_script_hash(), True),
    ],
    root_after_first,
  )
}

test host_state_reference_reclaim_rejects_wrong_predecessor() fail {
  validate_bad_reference_suffix(
    [
      inventory_reference_input(2, test_reference_script_hash(), True),
      inventory_reference_input(3, test_reference_script_hash(), True),
    ],
    #"4444444444444444444444444444444444444444444444444444444444444444",
  )
}

test host_state_reference_reclaim_rejects_recreated_validator_outputs() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let root_after_first =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  let id_2 = inventory_identity(2, test_reference_script_hash())
  let target_root = append_reference_script_identities(root_after_first, [id_2])
  let shutdown = Sealed { sealed_at: 1_000, proof_window_end: 2_000 }
  let recreated =
    inventory_reference_input(9, test_reference_script_hash(), True).output
  spend_inventory_transition(
    registered_inventory_datum(
      2,
      target_root,
      2,
      target_root,
      test_object_ref(2),
      shutdown,
      2,
    ),
    registered_inventory_datum(
      1,
      root_after_first,
      2,
      target_root,
      test_object_ref(2),
      shutdown,
      3,
    ),
    ReclaimReferenceScripts { predecessor_root: root_after_first },
    [],
    [inventory_reference_input(2, test_reference_script_hash(), True)],
    [recreated],
    [trusted_deployer],
    2_000,
  )
}

test host_state_reference_reclaim_rejects_before_the_proof_window() fail {
  let id_1 = inventory_identity(1, test_reference_script_hash())
  let target_root =
    append_reference_script_identities(
      empty_reference_script_inventory_root,
      [id_1],
    )
  let shutdown = Sealed { sealed_at: 1_000, proof_window_end: 2_000 }
  spend_inventory_transition(
    registered_inventory_datum(
      1,
      target_root,
      1,
      target_root,
      test_object_ref(1),
      shutdown,
      1,
    ),
    registered_inventory_datum(
      0,
      empty_reference_script_inventory_root,
      1,
      target_root,
      test_object_ref(1),
      shutdown,
      2,
    ),
    ReclaimReferenceScripts {
      predecessor_root: empty_reference_script_inventory_root,
    },
    [],
    [inventory_reference_input(1, test_reference_script_hash(), True)],
    [],
    [trusted_deployer],
    1_999,
  )
}
