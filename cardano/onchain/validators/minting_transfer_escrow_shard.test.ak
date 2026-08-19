use aiken/collection/pairs
use cardano/address.{from_script}
use cardano/assets.{PolicyId, ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  CreateEscrowShard, TransferEscrowShardRedeemer,
}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use minting_transfer_escrow_shard

type MockData {
  transfer_port_token: AuthToken,
  transfer_escrow_shard_policy_id: PolicyId,
  module_input: Input,
  channel_id: ByteArray,
  denom: ByteArray,
  shard_token_name: ByteArray,
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

fn siblings_with_one(
  value: ByteArray,
  value_index: Int,
  remaining: Int,
) -> List<ByteArray> {
  if remaining <= 0 {
    []
  } else {
    [
      if value_index == 0 {
        value
      } else {
        ibc_state_commitment.empty_hash
      },
      ..siblings_with_one(value, value_index - 1, remaining - 1)
    ]
  }
}

fn setup() -> MockData {
  let transfer_port_token =
    AuthToken {
      policy_id: "mock port minting policy id",
      name: "mock transfer port token name",
    }
  let transfer_escrow_shard_policy_id = "mock transfer escrow shard policy id"
  let channel_id = "channel-0"
  let denom = "6c6f76656c616365"
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock transfer module script hash"),
        value: from_asset(
          transfer_port_token.policy_id,
          transfer_port_token.name,
          1,
        ),
        datum: NoDatum,
        reference_script: None,
      },
    }

  MockData {
    transfer_port_token,
    transfer_escrow_shard_policy_id,
    module_input,
    channel_id,
    denom,
    shard_token_name,
  }
}

fn create_transaction_with_registry(
  mock: MockData,
  root_is_reference: Bool,
  old_registry_root: ByteArray,
  siblings: List<ByteArray>,
) -> Transaction {
  let data =
    FungibleTokenPacketData {
      denom: mock.denom,
      amount: "1000",
      sender: "sender",
      receiver: "receiver",
      memo: "",
    }
  let new_root =
    ibc_state_commitment.apply_update(
      old_registry_root,
      transfer_escrow_shard.shard_registry_key(mock.channel_id, mock.denom),
      "",
      transfer_escrow_shard.registered_shard_value,
      siblings,
    )
  let redeemer: TransferEscrowShardRedeemer =
    CreateEscrowShard {
      channel_id: mock.channel_id,
      denom: mock.denom,
      data,
      registry_siblings: siblings,
    }
  let redeemer_data: Redeemer = redeemer
  let module_output =
    Output {
      ..mock.module_input.output,
      datum: InlineDatum(
        TransferModuleDatum { escrow_shard_registry_root: new_root },
      ),
    }
  let created_output =
    Output {
      address: mock.module_input.output.address,
      value: from_asset(ada_policy_id, ada_asset_name, 1000)
        |> add(mock.transfer_escrow_shard_policy_id, mock.shard_token_name, 1),
      datum: InlineDatum(
        TransferEscrowDatum { channel_id: mock.channel_id, denom: mock.denom },
      ),
      reference_script: None,
    }

  Transaction {
    ..transaction.placeholder,
    inputs: if root_is_reference {
      []
    } else {
      [mock.module_input]
    },
    reference_inputs: if root_is_reference {
      [mock.module_input]
    } else {
      []
    },
    outputs: [module_output, created_output],
    mint: from_asset(
      mock.transfer_escrow_shard_policy_id,
      mock.shard_token_name,
      1,
    ),
    redeemers: [Pair(Mint(mock.transfer_escrow_shard_policy_id), redeemer_data)],
  }
}

fn create_transaction(mock: MockData, root_is_reference: Bool) -> Transaction {
  create_transaction_with_registry(
    mock,
    root_is_reference,
    empty_escrow_shard_registry_root,
    full_empty_siblings(),
  )
}

test create_transfer_escrow_shard_succeeds() {
  let mock = setup()
  let transaction = create_transaction(mock, False)
  expect Some(redeemer) =
    transaction.redeemers
      |> pairs.get_first(Mint(mock.transfer_escrow_shard_policy_id))
  expect decoded_redeemer: TransferEscrowShardRedeemer = redeemer
  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    transaction,
  )
}

test create_second_transfer_escrow_shard_succeeds() {
  let first = setup()
  let first_root =
    ibc_state_commitment.apply_update(
      empty_escrow_shard_registry_root,
      transfer_escrow_shard.shard_registry_key(first.channel_id, first.denom),
      "",
      transfer_escrow_shard.registered_shard_value,
      full_empty_siblings(),
    )
  expect
    first_root == #"c4f9463d717cd34518c7876cdb6f01fde35b8f465aac7d45d890b5ad67ece44d"

  let second_channel_id = "channel-1"
  let second =
    MockData {
      ..first,
      channel_id: second_channel_id,
      shard_token_name: transfer_escrow_shard.shard_token_name(
        second_channel_id,
        first.denom,
      ),
      module_input: Input {
        ..first.module_input,
        output: Output {
          ..first.module_input.output,
          datum: InlineDatum(
            TransferModuleDatum { escrow_shard_registry_root: first_root },
          ),
        },
      },
    }
  let siblings =
    siblings_with_one(
      #"c0c8ffa3c2dd5066f3f810bcd79a97ee278eb2933690e0d02ba0bd0af5096f54",
      59,
      ibc_state_commitment.merkle_depth_bits,
    )
  let transaction =
    create_transaction_with_registry(second, False, first_root, siblings)
  expect [updated_module_output, _] = transaction.outputs
  expect InlineDatum(updated_module_raw) = updated_module_output.datum
  expect updated_module_datum: TransferModuleDatum = updated_module_raw
  expect
    updated_module_datum.escrow_shard_registry_root == #"2717ca02e59e7d857f2d737424e4802c90864d79547b2d81ac77151af4455c18"
  expect Some(redeemer) =
    transaction.redeemers
      |> pairs.get_first(Mint(second.transfer_escrow_shard_policy_id))
  expect decoded_redeemer: TransferEscrowShardRedeemer = redeemer

  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    second.transfer_port_token,
    decoded_redeemer,
    second.transfer_escrow_shard_policy_id,
    transaction,
  )
}

test create_transfer_escrow_shard_rejects_reference_only_root() fail {
  let mock = setup()
  let transaction = create_transaction(mock, True)
  expect Some(redeemer) =
    transaction.redeemers
      |> pairs.get_first(Mint(mock.transfer_escrow_shard_policy_id))
  expect decoded_redeemer: TransferEscrowShardRedeemer = redeemer
  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    transaction,
  )
}

test create_transfer_escrow_shard_rejects_replay() fail {
  let mock = setup()
  let first = create_transaction(mock, False)
  expect [registered_module_output, created_output] = first.outputs
  let replay_input =
    Input { ..mock.module_input, output: registered_module_output }
  let replay =
    Transaction {
      ..first,
      inputs: [replay_input],
      outputs: [registered_module_output, created_output],
    }
  expect Some(redeemer) =
    replay.redeemers
      |> pairs.get_first(Mint(mock.transfer_escrow_shard_policy_id))
  expect decoded_redeemer: TransferEscrowShardRedeemer = redeemer
  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    replay,
  )
}
