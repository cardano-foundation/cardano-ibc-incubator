use cardano/address.{from_script}
use cardano/assets.{PolicyId, ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  BurnEscrowShard, CreateEscrowShard, TransferEscrowShardRedeemer,
}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use minting_transfer_escrow_shard

type MockData {
  transfer_port_token: AuthToken,
  transfer_escrow_shard_policy_id: PolicyId,
  module_reference_input: Input,
  channel_id: ByteArray,
  denom: ByteArray,
  shard_token_name: ByteArray,
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

  let module_reference_input =
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
    module_reference_input,
    channel_id,
    denom,
    shard_token_name,
  }
}

test create_transfer_escrow_shard_succeeds() {
  let mock = setup()
  let data =
    FungibleTokenPacketData {
      denom: mock.denom,
      amount: "1000",
      sender: "sender",
      receiver: "receiver",
      memo: "",
    }
  let redeemer: TransferEscrowShardRedeemer =
    CreateEscrowShard { channel_id: mock.channel_id, denom: mock.denom, data }
  let created_output =
    Output {
      address: mock.module_reference_input.output.address,
      value: from_asset(ada_policy_id, ada_asset_name, 1000)
        |> add(mock.transfer_escrow_shard_policy_id, mock.shard_token_name, 1),
      datum: InlineDatum(
        TransferEscrowDatum { channel_id: mock.channel_id, denom: mock.denom },
      ),
      reference_script: None,
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      reference_inputs: [mock.module_reference_input],
      outputs: [created_output],
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        mock.shard_token_name,
        1,
      ),
    }

  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    redeemer,
    mock.transfer_escrow_shard_policy_id,
    transaction,
  )
}

test burn_transfer_escrow_shard_succeeds() {
  let mock = setup()
  let shard_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        output_index: 0,
      },
      output: Output {
        address: mock.module_reference_input.output.address,
        value: from_asset(
          mock.transfer_escrow_shard_policy_id,
          mock.shard_token_name,
          1,
        ),
        datum: InlineDatum(
          TransferEscrowDatum { channel_id: mock.channel_id, denom: mock.denom },
        ),
        reference_script: None,
      },
    }
  let redeemer: TransferEscrowShardRedeemer =
    BurnEscrowShard { channel_id: mock.channel_id, denom: mock.denom }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [shard_input],
      mint: from_asset(
        mock.transfer_escrow_shard_policy_id,
        mock.shard_token_name,
        -1,
      ),
    }

  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    redeemer,
    mock.transfer_escrow_shard_policy_id,
    transaction,
  )
}
