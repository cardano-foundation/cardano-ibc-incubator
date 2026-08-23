use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  RetireEscrowShard, TransferEscrowShardRedeemer,
}
use ibc/apps/transfer/transfer_module_redeemer.{ReclaimEscrowShard}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/transfer_module_datum.{TransferModuleDatum}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height
use ibc/core/ics_004/channel_datum.{
  ChannelActive, ChannelDatum, ChannelDatumState,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{ChannelState, Closed, Open}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  IBCModuleRedeemer, ModuleOperatorV1, Operator,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use minting_transfer_escrow_shard
use spending_transfer_module

const host_policy: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

const channel_policy: PolicyId =
  #"02020202020202020202020202020202020202020202020202020202"

const port_policy: PolicyId =
  #"03030303030303030303030303030303030303030303030303030303"

const module_policy: PolicyId =
  #"04040404040404040404040404040404040404040404040404040404"

const shard_policy: PolicyId =
  #"05050505050505050505050505050505050505050505050505050505"

const voucher_policy: PolicyId =
  #"06060606060606060606060606060606060606060606060606060606"

const lifecycle_policy: PolicyId =
  #"07070707070707070707070707070707070707070707070707070707"

const host_script_hash: Hash<Blake2b_224, Script> =
  #"11111111111111111111111111111111111111111111111111111111"

const channel_script_hash: Hash<Blake2b_224, Script> =
  #"12121212121212121212121212121212121212121212121212121212"

const module_script_hash: Hash<Blake2b_224, Script> =
  #"13131313131313131313131313131313131313131313131313131313"

const port_id = "transfer"

const channel_id = "channel-0"

// The packet denomination is the UTF-8 hexadecimal spelling of `lovelace`.
const denom = "6c6f76656c616365"

const host_ref =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 0,
  }

const module_ref =
  OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 0,
  }

const other_module_ref =
  OutputReference {
    transaction_id: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    output_index: 0,
  }

const shard_ref =
  OutputReference {
    transaction_id: #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    output_index: 0,
  }

const other_shard_ref =
  OutputReference {
    transaction_id: #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    output_index: 0,
  }

const channel_ref =
  OutputReference {
    transaction_id: #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    output_index: 0,
  }

// These roots and the only non-empty sibling at height 62 are generated from:
//   escrowShards/<derived shard token name> = #01
//   escrowShardCounts/6368616e6e656c2d30 = #01
// Keeping them literal avoids charging sparse-tree fixture construction to the
// validator execution-unit measurements.
const live_registry_root =
  #"41b9426d651580d87d364a602892452a8781f9fd150e7ff990735f7edccd2f72"

const retired_marker_with_live_count_root =
  #"18c49c5fa962c67e429e18c54c568b50a2249ddf02a1da7c97bb8e029f8cad11"

const retired_registry_root =
  #"74362bacd71db18c6919b108869b5b460fed731f8998b267548ef93929cedb29"

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn siblings_with_one(value: ByteArray, value_index: Int) -> List<ByteArray> {
  if value_index < 0 {
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )
  } else {
    siblings_with_one_from(value, value_index, 0)
  }
}

fn siblings_with_one_from(
  value: ByteArray,
  value_index: Int,
  index: Int,
) -> List<ByteArray> {
  if index >= ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    [
      if index == value_index {
        value
      } else {
        ibc_state_commitment.empty_hash
      },
      ..siblings_with_one_from(value, value_index, index + 1)
    ]
  }
}

fn registry_siblings() -> List<ByteArray> {
  siblings_with_one(
    #"3a4484a63219f37823e10159ad4aad2bf985bab77a3063d946dc99f775e42cdf",
    62,
  )
}

fn channel_count_siblings() -> List<ByteArray> {
  siblings_with_one(
    #"a6e615a5887cacc73f8dde66b29ab7d23d769720a2b877023f894fe6755705f2",
    62,
  )
}

fn port_token() -> AuthToken {
  AuthToken { policy_id: port_policy, name: "port token" }
}

fn module_token() -> AuthToken {
  AuthToken { policy_id: module_policy, name: "module token" }
}

fn other_port_token() -> AuthToken {
  AuthToken { policy_id: port_policy, name: "other port token" }
}

fn other_module_token() -> AuthToken {
  AuthToken { policy_id: module_policy, name: "other module token" }
}

fn channel_token() -> AuthToken {
  let host_token =
    AuthToken { policy_id: host_policy, name: host_state_token_name }
  AuthToken {
    policy_id: channel_policy,
    name: auth.generate_token_name(host_token, channel_keys.channel_prefix, "0"),
  }
}

fn shard_token_name() -> ByteArray {
  transfer_escrow_shard.shard_token_name(channel_id, denom)
}

fn other_shard_token_name() -> ByteArray {
  transfer_escrow_shard.shard_token_name("channel-1", denom)
}

fn host_output() -> Output {
  Output {
    address: from_script(host_script_hash),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(host_policy, host_state_token_name, 1),
    // The transfer validators require the unique HostState NFT thread and an
    // inline datum, but do not interpret HostState during this operator action.
    datum: InlineDatum(0),
    reference_script: None,
  }
}

fn host_input() -> Input {
  Input { output_reference: host_ref, output: host_output() }
}

fn module_input(registry_root: ByteArray) -> Input {
  Input {
    output_reference: module_ref,
    output: Output {
      address: from_script(module_script_hash),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(port_policy, port_token().name, 1)
        |> assets.add(module_policy, module_token().name, 1),
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: registry_root,
          live_escrow_shard_count: 1,
          voucher_supply: 7,
        },
      ),
      reference_script: None,
    },
  }
}

fn shard_input(escrowed_amount: Int) -> Input {
  Input {
    output_reference: shard_ref,
    output: Output {
      address: from_script(module_script_hash),
      value: assets.from_lovelace(3_000_000)
        |> assets.add(shard_policy, shard_token_name(), 1),
      datum: InlineDatum(
        TransferEscrowDatum { channel_id, denom, escrowed_amount },
      ),
      reference_script: None,
    },
  }
}

fn other_shard_input() -> Input {
  Input {
    output_reference: other_shard_ref,
    output: Output {
      address: from_script(module_script_hash),
      value: assets.from_lovelace(3_000_000)
        |> assets.add(shard_policy, other_shard_token_name(), 1),
      datum: InlineDatum(
        TransferEscrowDatum {
          channel_id: "channel-1",
          denom,
          escrowed_amount: 0,
        },
      ),
      reference_script: None,
    },
  }
}

fn module_output(lovelace: Int) -> Output {
  Output {
    address: from_script(module_script_hash),
    value: assets.from_lovelace(lovelace)
      |> assets.add(port_policy, port_token().name, 1)
      |> assets.add(module_policy, module_token().name, 1),
    datum: InlineDatum(
      TransferModuleDatum {
        escrow_shard_registry_root: retired_registry_root,
        live_escrow_shard_count: 0,
        voucher_supply: 7,
      },
    ),
    reference_script: None,
  }
}

fn channel_input(state: ChannelState) -> Input {
  let datum =
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
  Input {
    output_reference: channel_ref,
    output: Output {
      address: from_script(channel_script_hash),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(channel_policy, channel_token().name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn retirement_redeemer(old_channel_count: Int) -> TransferEscrowShardRedeemer {
  RetireEscrowShard {
    channel_id,
    denom,
    registry_siblings: registry_siblings(),
    old_channel_live_escrow_shard_count: old_channel_count,
    channel_live_escrow_shard_count_siblings: channel_count_siblings(),
    transfer_port_token: port_token(),
  }
}

fn module_redeemer() -> IBCModuleRedeemer {
  Operator(ModuleOperatorV1(ReclaimEscrowShard { channel_id, denom }))
}

fn other_shard_module_redeemer() -> IBCModuleRedeemer {
  Operator(
    ModuleOperatorV1(ReclaimEscrowShard { channel_id: "channel-1", denom }),
  )
}

fn retirement_transaction(
  escrowed_amount: Int,
  channel_state: ChannelState,
  old_registry_root: ByteArray,
  old_channel_count: Int,
  module_output_lovelace: Int,
) -> Transaction {
  let spend_redeemer: Redeemer = module_redeemer()
  let mint_redeemer: Redeemer = retirement_redeemer(old_channel_count)
  Transaction {
    ..transaction.placeholder,
    inputs: [
      host_input(),
      module_input(old_registry_root),
      shard_input(escrowed_amount),
    ],
    reference_inputs: [channel_input(channel_state)],
    outputs: [host_output(), module_output(module_output_lovelace)],
    mint: assets.from_asset(shard_policy, shard_token_name(), -1),
    validity_range: interval.after(1),
    redeemers: [
      Pair(Spend(module_ref), spend_redeemer),
      Pair(Spend(shard_ref), spend_redeemer),
      Pair(Mint(shard_policy), mint_redeemer),
    ],
  }
}

fn valid_retirement_transaction() -> Transaction {
  retirement_transaction(0, Closed, live_registry_root, 1, 5_000_000)
}

fn retirement_with_extra_shard_spend() -> Transaction {
  let base = valid_retirement_transaction()
  let extra_shard = other_shard_input()
  let extra_redeemer: Redeemer = other_shard_module_redeemer()
  let diverted_extra_shard =
    Output {
      address: from_script("attacker script hash"),
      value: extra_shard.output.value,
      datum: NoDatum,
      reference_script: None,
    }
  Transaction {
    ..base,
    inputs: [extra_shard, ..base.inputs],
    outputs: [diverted_extra_shard, ..base.outputs],
    redeemers: [Pair(Spend(other_shard_ref), extra_redeemer), ..base.redeemers],
  }
}

fn retirement_with_second_module_root() -> Transaction {
  let base = valid_retirement_transaction()
  let other_input_output =
    Output {
      address: from_script("other module script hash"),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(port_policy, other_port_token().name, 1)
        |> assets.add(module_policy, other_module_token().name, 1),
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: live_registry_root,
          live_escrow_shard_count: 9,
          voucher_supply: 11,
        },
      ),
      reference_script: None,
    }
  let other_input =
    Input { output_reference: other_module_ref, output: other_input_output }
  let mutated_other_output =
    Output {
      ..other_input_output,
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: retired_registry_root,
          live_escrow_shard_count: 0,
          voucher_supply: 0,
        },
      ),
    }
  let other_redeemer: Redeemer = module_redeemer()
  Transaction {
    ..base,
    inputs: [other_input, ..base.inputs],
    outputs: [mutated_other_output, ..base.outputs],
    redeemers: [Pair(Spend(other_module_ref), other_redeemer), ..base.redeemers],
  }
}

fn validate_module_root_spend(transaction: Transaction) -> Bool {
  spending_transfer_module.spend_transfer_module.spend(
    port_token(),
    module_token(),
    port_id,
    shard_policy,
    channel_policy,
    voucher_policy,
    host_policy,
    lifecycle_policy,
    None,
    module_redeemer(),
    module_ref,
    transaction,
  )
}

fn validate_shard_spend(transaction: Transaction) -> Bool {
  spending_transfer_module.spend_transfer_module.spend(
    port_token(),
    module_token(),
    port_id,
    shard_policy,
    channel_policy,
    voucher_policy,
    host_policy,
    lifecycle_policy,
    None,
    module_redeemer(),
    shard_ref,
    transaction,
  )
}

fn validate_other_shard_spend(transaction: Transaction) -> Bool {
  spending_transfer_module.spend_transfer_module.spend(
    port_token(),
    module_token(),
    port_id,
    shard_policy,
    channel_policy,
    voucher_policy,
    host_policy,
    lifecycle_policy,
    None,
    other_shard_module_redeemer(),
    other_shard_ref,
    transaction,
  )
}

fn validate_other_module_root_spend(transaction: Transaction) -> Bool {
  spending_transfer_module.spend_transfer_module.spend(
    other_port_token(),
    other_module_token(),
    "other-transfer",
    shard_policy,
    channel_policy,
    voucher_policy,
    host_policy,
    lifecycle_policy,
    None,
    module_redeemer(),
    other_module_ref,
    transaction,
  )
}

fn validate_shard_mint(transaction: Transaction, old_channel_count: Int) -> Bool {
  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    port_token(),
    port_id,
    channel_policy,
    host_policy,
    retirement_redeemer(old_channel_count),
    shard_policy,
    transaction,
  )
}

test retire_zero_balance_escrow_shard_module_root_spend_succeeds() {
  valid_retirement_transaction()
    |> validate_module_root_spend
}

test retire_zero_balance_escrow_shard_spend_succeeds() {
  valid_retirement_transaction()
    |> validate_shard_spend
}

test retire_zero_balance_escrow_shard_mint_succeeds() {
  valid_retirement_transaction()
    |> validate_shard_mint(1)
}

test retire_escrow_shard_rejects_second_root_sharing_shard_policy() fail {
  retirement_with_second_module_root()
    |> validate_other_module_root_spend
}

test retire_escrow_shard_rejects_co_spending_and_diverting_another_shard() fail {
  let transaction = retirement_with_extra_shard_spend()
  and {
    validate_other_shard_spend(transaction),
    validate_shard_mint(transaction, 1),
  }
}

test retire_escrow_shard_policy_rejects_second_shard_policy_input() fail {
  retirement_with_extra_shard_spend()
    |> validate_shard_mint(1)
}

test retire_escrow_shard_rejects_nonzero_logical_principal() fail {
  retirement_transaction(1, Closed, live_registry_root, 1, 5_000_000)
    |> validate_shard_mint(1)
}

test retire_escrow_shard_rejects_live_channel() fail {
  retirement_transaction(0, Open, live_registry_root, 1, 5_000_000)
    |> validate_shard_mint(1)
}

test retire_escrow_shard_rejects_already_retired_registry_marker() fail {
  retirement_transaction(
    0,
    Closed,
    retired_marker_with_live_count_root,
    1,
    5_000_000,
  )
    |> validate_shard_mint(1)
}

test retire_escrow_shard_rejects_incorrect_channel_count_witness() fail {
  retirement_transaction(0, Closed, live_registry_root, 2, 5_000_000)
    |> validate_shard_mint(2)
}

test retire_escrow_shard_rejects_value_not_absorbed_by_module_root() fail {
  retirement_transaction(0, Closed, live_registry_root, 1, 2_000_000)
    |> validate_shard_mint(1)
}
