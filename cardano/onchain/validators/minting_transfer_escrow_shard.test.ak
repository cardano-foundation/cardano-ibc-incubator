use aiken/collection/pairs
use cardano/address.{from_script}
use cardano/assets.{PolicyId, ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  CreateEscrowShard, CreateEscrowShardV2, TransferEscrowShardRedeemer,
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
  transfer_port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
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

fn first_channel_count_siblings() -> List<ByteArray> {
  siblings_with_one(
    #"b71e3626559d4953959cb9f8eb2ed18b15c0e64dad05c0c181b923e7ce2c408f",
    62,
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
  let transfer_port_id = "transfer"
  let channel_minting_policy_id = "mock channel minting policy id"
  let host_state_nft_policy_id = "mock host state nft policy id"
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
        )
          |> add(ada_policy_id, ada_asset_name, 2_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }

  MockData {
    transfer_port_token,
    transfer_port_id,
    channel_minting_policy_id,
    host_state_nft_policy_id,
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
  count_siblings: List<ByteArray>,
) -> Transaction {
  let data =
    FungibleTokenPacketData {
      denom: mock.denom,
      amount: "1000",
      sender: "sender",
      receiver: "receiver",
      memo: "",
    }
  let root_after_marker =
    ibc_state_commitment.apply_update(
      old_registry_root,
      transfer_escrow_shard.shard_registry_key(mock.channel_id, mock.denom),
      "",
      transfer_escrow_shard.registered_shard_value,
      siblings,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      root_after_marker,
      transfer_escrow_shard.channel_live_shard_count_key(mock.channel_id),
      "",
      #[1],
      count_siblings,
    )
  let redeemer: TransferEscrowShardRedeemer =
    CreateEscrowShardV2 {
      channel_id: mock.channel_id,
      denom: mock.denom,
      data,
      registry_siblings: siblings,
      old_channel_live_escrow_shard_count: 0,
      channel_live_escrow_shard_count_siblings: count_siblings,
    }
  let redeemer_data: Redeemer = redeemer
  let module_output =
    Output {
      ..mock.module_input.output,
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: new_root,
          live_escrow_shard_count: 1,
          voucher_supply: 0,
        },
      ),
    }
  let created_output =
    Output {
      address: mock.module_input.output.address,
      value: from_asset(ada_policy_id, ada_asset_name, 1000)
        |> add(mock.transfer_escrow_shard_policy_id, mock.shard_token_name, 1),
      datum: InlineDatum(
        TransferEscrowDatum {
          channel_id: mock.channel_id,
          denom: mock.denom,
          escrowed_amount: 1000,
        },
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
    first_channel_count_siblings(),
  )
}

fn validate_module_value_transition_at_count_boundary(
  lovelace_delta: Int,
  mutate_non_ada: Bool,
) -> Bool {
  let mock = setup()
  let transaction = create_transaction(mock, False)
  expect [base_module_output, created_output] = transaction.outputs
  expect InlineDatum(raw_new_datum) = base_module_output.datum
  expect new_datum: TransferModuleDatum = raw_new_datum
  let module_input =
    Input {
      ..mock.module_input,
      output: Output {
        ..mock.module_input.output,
        datum: InlineDatum(
          TransferModuleDatum {
            escrow_shard_registry_root: empty_escrow_shard_registry_root,
            live_escrow_shard_count: 23,
            voucher_supply: 0,
          },
        ),
      },
    }
  let module_output =
    Output {
      ..base_module_output,
      value: module_input.output.value
        |> add(ada_policy_id, ada_asset_name, lovelace_delta)
        |> add(
            "foreign asset policy",
            "foreign asset name",
            if mutate_non_ada {
              1
            } else {
              0
            },
          ),
      datum: InlineDatum(
        TransferModuleDatum { ..new_datum, live_escrow_shard_count: 24 },
      ),
    }
  let updated_transaction =
    Transaction {
      ..transaction,
      inputs: [module_input],
      outputs: [module_output, created_output],
    }
  expect Some(redeemer) =
    updated_transaction.redeemers
      |> pairs.get_first(Mint(mock.transfer_escrow_shard_policy_id))
  expect decoded_redeemer: TransferEscrowShardRedeemer = redeemer

  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    mock.transfer_port_id,
    mock.channel_minting_policy_id,
    mock.host_state_nft_policy_id,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    updated_transaction,
  )
}

test create_shard_accepts_module_min_ada_top_up_at_count_23_to_24() {
  validate_module_value_transition_at_count_boundary(500_000, False)
}

test create_shard_rejects_module_lovelace_decrease_at_count_23_to_24() fail {
  validate_module_value_transition_at_count_boundary(-1, False)
}

test create_shard_rejects_module_non_ada_asset_mutation_at_count_23_to_24() fail {
  validate_module_value_transition_at_count_boundary(0, True)
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
    mock.transfer_port_id,
    mock.channel_minting_policy_id,
    mock.host_state_nft_policy_id,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    transaction,
  )
}

test legacy_create_transfer_escrow_shard_is_rejected() fail {
  let mock = setup()
  let transaction = create_transaction(mock, False)
  let data =
    FungibleTokenPacketData {
      denom: mock.denom,
      amount: "1000",
      sender: "sender",
      receiver: "receiver",
      memo: "",
    }
  let legacy_redeemer: TransferEscrowShardRedeemer =
    CreateEscrowShard {
      channel_id: mock.channel_id,
      denom: mock.denom,
      data,
      registry_siblings: full_empty_siblings(),
    }
  minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
    mock.transfer_port_token,
    mock.transfer_port_id,
    mock.channel_minting_policy_id,
    mock.host_state_nft_policy_id,
    legacy_redeemer,
    mock.transfer_escrow_shard_policy_id,
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
    mock.transfer_port_id,
    mock.channel_minting_policy_id,
    mock.host_state_nft_policy_id,
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
    mock.transfer_port_id,
    mock.channel_minting_policy_id,
    mock.host_state_nft_policy_id,
    decoded_redeemer,
    mock.transfer_escrow_shard_policy_id,
    replay,
  )
}
