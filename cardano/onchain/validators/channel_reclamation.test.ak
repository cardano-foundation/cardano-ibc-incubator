use aiken/builtin
use aiken/cbor
use aiken/crypto.{Blake2b_224, Hash, Script, VerificationKeyHash}
use aiken/interval
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId, add}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, Spend,
  Transaction, placeholder,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionActive, ConnectionDatum,
}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  DecrementChannelCount,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_004/channel_datum.{
  Abandoning, ChannelActive, ChannelDatum, ChannelDatumState,
}
use ibc/core/ics_004/channel_redeemer as channel_redeemer
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{ChannelState, Closed, Init}
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanReclaim}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ModuleRegistration, empty_ibc_state_root,
  host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer as host_redeemer
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeTransferChannelReclaim, LifecycleMarkerRedeemer,
  lifecycle_marker_token_name,
}
use ibc/core/ics_025_handler_interface/reclamation
use ibc/utils/bits
use ibc/utils/validator_utils
use minting_channel_stt
use minting_lifecycle_marker
use spending_channel
use spending_transfer_module

const host_policy: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

const channel_policy: PolicyId =
  #"02020202020202020202020202020202020202020202020202020202"

const client_policy: PolicyId =
  #"14141414141414141414141414141414141414141414141414141414"

const connection_policy: PolicyId =
  #"15151515151515151515151515151515151515151515151515151515"

const port_policy: PolicyId =
  #"03030303030303030303030303030303030303030303030303030303"

const module_policy: PolicyId =
  #"04040404040404040404040404040404040404040404040404040404"

const lifecycle_policy: PolicyId =
  #"16161616161616161616161616161616161616161616161616161616"

const channel_script_hash: Hash<Blake2b_224, Script> =
  #"05050505050505050505050505050505050505050505050505050505"

const connection_script_hash: Hash<Blake2b_224, Script> =
  #"17171717171717171717171717171717171717171717171717171717"

const host_script_hash: Hash<Blake2b_224, Script> =
  #"06060606060606060606060606060606060606060606060606060606"

const module_script_hash: Hash<Blake2b_224, Script> =
  #"07070707070707070707070707070707070707070707070707070707"

const deployer: VerificationKeyHash =
  #"08080808080808080808080808080808080808080808080808080808"

const reclaim_to: VerificationKeyHash =
  #"09090909090909090909090909090909090909090909090909090909"

const other_reclaim_to: VerificationKeyHash =
  #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"

const port_id = "transfer"

const channel_lovelace = 3_000_000

const host_ref =
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 0,
  }

const channel_ref =
  OutputReference {
    transaction_id: #"1212121212121212121212121212121212121212121212121212121212121212",
    output_index: 0,
  }

const module_ref =
  OutputReference {
    transaction_id: #"1313131313131313131313131313131313131313131313131313131313131313",
    output_index: 0,
  }

const connection_ref =
  OutputReference {
    transaction_id: #"1818181818181818181818181818181818181818181818181818181818181818",
    output_index: 0,
  }

fn channel_token() -> AuthToken {
  let host_token =
    AuthToken { policy_id: host_policy, name: host_state_token_name }
  AuthToken {
    policy_id: channel_policy,
    name: auth.generate_token_name(host_token, channel_keys.channel_prefix, "0"),
  }
}

fn port_token() -> AuthToken {
  AuthToken { policy_id: port_policy, name: "port token" }
}

fn module_token() -> AuthToken {
  AuthToken { policy_id: module_policy, name: "module token" }
}

fn registration() -> ModuleRegistration {
  ModuleRegistration {
    module_script_hash,
    port_token: port_token(),
    module_token: module_token(),
  }
}

fn host_datum() -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [Pair(port_id, registration())],
      last_update_time: 0,
      live_client_count: 1,
      live_connection_count: 1,
      live_channel_count: 1,
    },
    nft_policy: host_policy,
    deployer,
    shutdown: Active,
    live_reference_script_count: Some(0),
    reference_script_inventory_root: empty_ibc_state_root,
    reference_script_registration: None,
  }
}

fn host_output() -> Output {
  Output {
    address: from_script(host_script_hash),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(host_policy, host_state_token_name, 1),
    datum: InlineDatum(host_datum()),
    reference_script: None,
  }
}

fn host_input() -> Input {
  Input { output_reference: host_ref, output: host_output() }
}

fn channel_datum(state: ChannelState) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: Channel {
        state,
        ordering: Unordered,
        counterparty: ChannelCounterparty {
          port_id: "counterparty",
          channel_id: "channel-1",
        },
        connection_hops: ["connection-0"],
        version: "ics20-1",
      },
      next_sequence_send: 1,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment: [],
      packet_receipt: [],
      packet_acknowledgement: [],
      minimum_receive_proof_height: height.zero_height(),
      maximum_receive_proof_height: height.zero_height(),
    },
    port_id,
    token: channel_token(),
    lifecycle: ChannelActive,
    voucher_supply: 0,
  }
}

fn channel_input(datum: ChannelDatum) -> Input {
  Input {
    output_reference: channel_ref,
    output: Output {
      address: from_script(channel_script_hash),
      value: assets.from_lovelace(channel_lovelace)
        |> assets.add(channel_policy, channel_token().name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn connection_token(policy_id: PolicyId) -> AuthToken {
  AuthToken {
    policy_id,
    name: auth.generate_token_name_from_another(
      channel_token().name,
      connection_keys.connection_prefix,
      "0",
    ),
  }
}

fn connection_input(policy_id: PolicyId) -> Input {
  let token = connection_token(policy_id)
  let datum =
    ConnectionDatum {
      state: ConnectionEnd {
        client_id: "07-tendermint-0",
        versions: version.get_compatible_versions(),
        state: connection_state.Open,
        counterparty: connection_counterparty.Counterparty {
          client_id: "07-tendermint-1",
          connection_id: "connection-1",
          prefix: MerklePrefix { key_prefix: "ibc" },
        },
        delay_period: 0,
      },
      token,
      live_channel_count: 1,
      lifecycle: ConnectionActive,
    }
  Input {
    output_reference: connection_ref,
    output: Output {
      address: from_script(connection_script_hash),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
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
    raise_single_leaf(
      key_hash,
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
      },
      depth + 1,
      target_depth,
    )
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
  single_sibling_list(
    0,
    divergence,
    raise_single_leaf(existing_key_hash, existing_leaf, 0, divergence),
  )
}

fn closed_channel_reclaim_commitment(
  datum: ChannelDatum,
) -> (ByteArray, List<ByteArray>, List<ByteArray>) {
  let send_key = packet_keys.next_sequence_send_path(datum.port_id, "channel-0")
  let ack_key = packet_keys.next_sequence_ack_path(datum.port_id, "channel-0")
  let send_value = cbor.serialise(datum.state.next_sequence_send)
  let ack_value = cbor.serialise(datum.state.next_sequence_ack)
  let after_send_insert =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      send_key,
      "",
      send_value,
      full_empty_siblings(),
    )
  let old_root =
    ibc_state_commitment.apply_update(
      after_send_insert,
      ack_key,
      "",
      ack_value,
      siblings_after_single_insert(send_key, send_value, ack_key),
    )
  (
    old_root,
    siblings_after_single_insert(ack_key, ack_value, send_key),
    full_empty_siblings(),
  )
}

fn module_input() -> Input {
  Input {
    output_reference: module_ref,
    output: Output {
      address: from_script(module_script_hash),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(port_policy, port_token().name, 1)
        |> assets.add(module_policy, module_token().name, 1),
      datum: InlineDatum(Void),
      reference_script: None,
    },
  }
}

fn transfer_module_datum(
  voucher_supply: Int,
  channel_has_live_shard: Bool,
) -> TransferModuleDatum {
  let registry_root =
    if channel_has_live_shard {
      ibc_state_commitment.apply_update(
        empty_escrow_shard_registry_root,
        transfer_escrow_shard.channel_live_shard_count_key("channel-0"),
        "",
        reclamation.encode_count(1),
        full_empty_siblings(),
      )
    } else {
      empty_escrow_shard_registry_root
    }
  TransferModuleDatum {
    escrow_shard_registry_root: registry_root,
    live_escrow_shard_count: if channel_has_live_shard {
      1
    } else {
      0
    },
    voucher_supply,
  }
}

fn transfer_module_input(datum: TransferModuleDatum) -> Input {
  let input = module_input()
  Input {
    ..input,
    output: Output { ..input.output, datum: InlineDatum(datum) },
  }
}

fn connection_successor() -> Output {
  let input = connection_input(connection_policy)
  expect datum: ConnectionDatum = validator_utils.get_inline_datum(input.output)
  Output {
    ..input.output,
    datum: InlineDatum(ConnectionDatum { ..datum, live_channel_count: 0 }),
  }
}

fn lifecycle_host_thread(
  old_root: ByteArray,
  new_root: ByteArray,
) -> (Input, Output) {
  let base_datum = host_datum()
  let old_datum =
    HostStateDatum {
      ..base_datum,
      state: HostState { ..base_datum.state, ibc_state_root: old_root },
    }
  let new_datum =
    HostStateDatum {
      ..old_datum,
      state: HostState {
        ..old_datum.state,
        version: old_datum.state.version + 1,
        ibc_state_root: new_root,
        live_channel_count: old_datum.state.live_channel_count - 1,
      },
    }
  let old_output = Output { ..host_output(), datum: InlineDatum(old_datum) }
  (
    Input { output_reference: host_ref, output: old_output },
    Output {
      ..old_output,
      value: old_output.value
        |> add(lifecycle_policy, lifecycle_marker_token_name, 1),
      datum: InlineDatum(new_datum),
    },
  )
}

fn transfer_channel_reclaim_transaction(
  global_voucher_supply: Int,
  channel_voucher_supply: Int,
  channel_has_live_shard: Bool,
  marker_redeemer: LifecycleMarkerRedeemer,
) -> Transaction {
  let datum =
    ChannelDatum {
      ..channel_datum(Closed),
      voucher_supply: channel_voucher_supply,
    }
  let (old_root, send_siblings, ack_siblings) =
    closed_channel_reclaim_commitment(datum)
  let (host_input, host_successor) =
    lifecycle_host_thread(old_root, empty_ibc_state_root)
  let module_datum =
    transfer_module_datum(global_voucher_supply, channel_has_live_shard)
  let module_input = transfer_module_input(module_datum)
  let host_redeemer_data: Redeemer =
    host_redeemer.ReclaimChannel {
      reclaim_to,
      channel_siblings: [],
      next_sequence_send_siblings: send_siblings,
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: ack_siblings,
    }
  let channel_redeemer_data: Redeemer =
    channel_redeemer.ReclaimChannel { reclaim_to }
  let connection_redeemer_data: Redeemer = DecrementChannelCount
  let callback: Redeemer =
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: full_empty_siblings(),
      },
    )
  let marker_redeemer_data: Redeemer = marker_redeemer
  Transaction {
    ..placeholder,
    inputs: [
      host_input,
      channel_input(datum),
      connection_input(connection_policy),
      module_input,
    ],
    outputs: [
      host_successor,
      connection_successor(),
      module_input.output,
      payout(channel_lovelace),
    ],
    mint: assets.from_asset(channel_policy, channel_token().name, -1)
      |> add(lifecycle_policy, lifecycle_marker_token_name, 1),
    redeemers: [
      Pair(Spend(host_ref), host_redeemer_data),
      Pair(Spend(channel_ref), channel_redeemer_data),
      Pair(Spend(connection_ref), connection_redeemer_data),
      Pair(Spend(module_ref), callback),
      Pair(Mint(lifecycle_policy), marker_redeemer_data),
    ],
  }
}

fn validate_transfer_channel_marker(
  global_voucher_supply: Int,
  channel_voucher_supply: Int,
  channel_has_live_shard: Bool,
  marker_redeemer: LifecycleMarkerRedeemer,
) -> Bool {
  let transaction =
    transfer_channel_reclaim_transaction(
      global_voucher_supply,
      channel_voucher_supply,
      channel_has_live_shard,
      marker_redeemer,
    )
  let callback =
    Callback(
      OnChanReclaim {
        channel_id: "channel-0",
        channel_live_escrow_shard_count_siblings: full_empty_siblings(),
      },
    )
  and {
    minting_lifecycle_marker.mint_lifecycle_marker.mint(
      host_policy,
      client_policy,
      connection_policy,
      channel_policy,
      marker_redeemer,
      lifecycle_policy,
      transaction,
    )?,
    spending_transfer_module.spend_transfer_module.spend(
      port_token(),
      module_token(),
      port_id,
      "unused shard policy",
      channel_policy,
      "unused voucher policy",
      host_policy,
      lifecycle_policy,
      None,
      callback,
      module_ref,
      transaction,
    )?,
  }
}

fn payout(lovelace: Int) -> Output {
  Output {
    address: from_verification_key(reclaim_to),
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(Void),
    reference_script: None,
  }
}

fn host_reclaim_redeemer() -> Redeemer {
  let redeemer: Redeemer =
    host_redeemer.ReclaimChannel {
      reclaim_to,
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
    }
  redeemer
}

fn reclaim_transaction_with_parent_policy(
  datum: ChannelDatum,
  bounty: Int,
  callback_channel_id: ByteArray,
  include_successor: Bool,
  valid_from: Int,
  parent_connection_policy: PolicyId,
) -> Transaction {
  let channel_spend_redeemer: Redeemer =
    channel_redeemer.ReclaimChannel { reclaim_to }
  let module_spend_redeemer: Redeemer =
    Callback(
      OnChanReclaim {
        channel_id: callback_channel_id,
        channel_live_escrow_shard_count_siblings: [],
      },
    )
  let connection_spend_redeemer: Redeemer = DecrementChannelCount
  let successor_outputs =
    if include_successor {
      [channel_input(datum).output]
    } else {
      []
    }

  Transaction {
    ..placeholder,
    inputs: [
      host_input(),
      channel_input(datum),
      connection_input(parent_connection_policy),
      module_input(),
    ],
    outputs: [host_output(), payout(bounty), ..successor_outputs],
    mint: assets.from_asset(channel_policy, channel_token().name, -1),
    validity_range: interval.after(valid_from),
    redeemers: [
      Pair(Spend(host_ref), host_reclaim_redeemer()),
      Pair(Spend(channel_ref), channel_spend_redeemer),
      Pair(Spend(connection_ref), connection_spend_redeemer),
      Pair(Spend(module_ref), module_spend_redeemer),
    ],
  }
}

fn reclaim_transaction(
  datum: ChannelDatum,
  bounty: Int,
  callback_channel_id: ByteArray,
  include_successor: Bool,
  valid_from: Int,
) -> Transaction {
  reclaim_transaction_with_parent_policy(
    datum,
    bounty,
    callback_channel_id,
    include_successor,
    valid_from,
    connection_policy,
  )
}

fn validate_reclaim(
  datum: ChannelDatum,
  transaction: Transaction,
  mint_reclaim_to: VerificationKeyHash,
) -> Bool {
  and {
    spending_channel.spend_channel.spend(
      "open ack",
      "open confirm",
      "close init",
      "close confirm",
      "recv",
      "send",
      "timeout",
      "acknowledge",
      "prune",
      host_policy,
      Some(datum),
      channel_redeemer.ReclaimChannel { reclaim_to },
      channel_ref,
      transaction,
    )?,
    minting_channel_stt.mint_channel_stt.mint(
      client_policy,
      connection_policy,
      port_policy,
      "verify proof policy",
      channel_script_hash,
      host_policy,
      channel_redeemer.BurnChannel {
        token: channel_token(),
        reclaim_to: mint_reclaim_to,
      },
      channel_policy,
      transaction,
    )?,
  }
}

test closed_drained_channel_reclaim_spend_and_burn_succeed() {
  let datum = channel_datum(Closed)
  reclaim_transaction(datum, channel_lovelace, "channel-0", False, 0)
    |> validate_reclaim(datum, _, reclaim_to)
}

test channel_reclaim_rejects_wrong_module_callback_channel() fail {
  let datum = channel_datum(Closed)
  reclaim_transaction(datum, channel_lovelace, "channel-1", False, 0)
    |> validate_reclaim(datum, _, reclaim_to)
}

test channel_reclaim_rejects_underpaid_bounty() fail {
  let datum = channel_datum(Closed)
  reclaim_transaction(datum, channel_lovelace - 1, "channel-0", False, 0)
    |> validate_reclaim(datum, _, reclaim_to)
}

test channel_reclaim_rejects_successor_with_auth_token() fail {
  let datum = channel_datum(Closed)
  reclaim_transaction(datum, channel_lovelace, "channel-0", True, 0)
    |> validate_reclaim(datum, _, reclaim_to)
}

test channel_burn_rejects_mismatched_reclaim_target() fail {
  let datum = channel_datum(Closed)
  reclaim_transaction(datum, channel_lovelace, "channel-0", False, 0)
    |> validate_reclaim(datum, _, other_reclaim_to)
}

fn transfer_channel_marker() -> LifecycleMarkerRedeemer {
  AuthorizeTransferChannelReclaim {
    port_id,
    port_token: port_token(),
    module_token: module_token(),
  }
}

test transfer_channel_reclaim_marker_accepts_settled_channel() {
  validate_transfer_channel_marker(0, 0, False, transfer_channel_marker())
}

test transfer_channel_reclaim_marker_accepts_unrelated_voucher_supply() {
  validate_transfer_channel_marker(1, 0, False, transfer_channel_marker())
}

test transfer_channel_reclaim_marker_rejects_own_voucher_supply() fail {
  validate_transfer_channel_marker(0, 1, False, transfer_channel_marker())
}

test transfer_channel_reclaim_marker_rejects_live_channel_shard_count() fail {
  validate_transfer_channel_marker(0, 0, True, transfer_channel_marker())
}

test transfer_channel_reclaim_marker_rejects_wrong_authenticated_target() fail {
  validate_transfer_channel_marker(
    0,
    0,
    False,
    AuthorizeTransferChannelReclaim {
      port_id: "other-transfer",
      port_token: port_token(),
      module_token: module_token(),
    },
  )
}

test abandoned_drained_channel_reclaim_succeeds_at_deadline() {
  let not_before = 50
  let datum =
    ChannelDatum { ..channel_datum(Init), lifecycle: Abandoning { not_before } }
  reclaim_transaction(datum, channel_lovelace, "channel-0", False, not_before)
    |> validate_reclaim(datum, _, reclaim_to)
}

test abandoned_channel_reclaim_rejects_before_deadline() fail {
  let not_before = 50
  let datum =
    ChannelDatum { ..channel_datum(Init), lifecycle: Abandoning { not_before } }
  reclaim_transaction(
    datum,
    channel_lovelace,
    "channel-0",
    False,
    not_before - 1,
  )
    |> validate_reclaim(datum, _, reclaim_to)
}

fn validate_begin_abandonment(
  has_deployer_signature: Bool,
  valid_from: Int,
  valid_to: Int,
  deadline_anchor: Int,
  delay_adjustment: Int,
) -> Bool {
  let not_before =
    reclamation.channel_abandonment_not_before(deadline_anchor) + delay_adjustment
  let input_datum = channel_datum(Init)
  let output_datum =
    ChannelDatum { ..input_datum, lifecycle: Abandoning { not_before } }
  let host_state_redeemer: Redeemer = host_redeemer.BeginChannelAbandonment
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input(), channel_input(input_datum)],
      outputs: [
        host_output(),
        Output {
          ..channel_input(input_datum).output,
          datum: InlineDatum(output_datum),
        },
      ],
      validity_range: interval.between(valid_from, valid_to),
      extra_signatories: if has_deployer_signature {
        [deployer]
      } else {
        []
      },
      redeemers: [Pair(Spend(host_ref), host_state_redeemer)],
    }

  spending_channel.spend_channel.spend(
    "open ack",
    "open confirm",
    "close init",
    "close confirm",
    "recv",
    "send",
    "timeout",
    "acknowledge",
    "prune",
    host_policy,
    Some(input_datum),
    channel_redeemer.BeginChannelAbandonment { not_before },
    channel_ref,
    transaction,
  )
}

test channel_abandonment_accepts_fixed_delay_and_deployer_signature() {
  let valid_from = 1_000
  let valid_to = valid_from + validator_utils.max_lifecycle_validity_width
  validate_begin_abandonment(True, valid_from, valid_to, valid_to, 0)
}

test channel_abandonment_rejects_missing_deployer_signature() fail {
  validate_begin_abandonment(False, 1_000, 2_000, 2_000, 0)
}

test channel_abandonment_rejects_caller_selected_delay() fail {
  validate_begin_abandonment(True, 1_000, 2_000, 2_000, 1)
}

test channel_abandonment_rejects_a_lower_bound_backdated_deadline() fail {
  validate_begin_abandonment(True, 1_000, 2_000, 1_000, 0)
}

test channel_abandonment_rejects_a_wide_validity_interval() fail {
  let valid_from = 1_000
  let valid_to = valid_from + validator_utils.max_lifecycle_validity_width + 1
  validate_begin_abandonment(True, valid_from, valid_to, valid_to, 0)
}
