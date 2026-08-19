use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/int
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  BurnEscrowShard, CreateEscrowShard, TransferEscrowShardRedeemer,
}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_transfer_escrow_shard(transfer_port_token: AuthToken) {
  mint(
    redeemer: TransferEscrowShardRedeemer,
    transfer_escrow_shard_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, .. } = transaction

    when redeemer is {
      // First native send mints a unique, one-shot shard NFT.
      CreateEscrowShard { channel_id, denom, data } ->
        validate_create_escrow_shard(
          inputs,
          outputs,
          mint,
          transfer_escrow_shard_policy_id,
          transfer_port_token,
          channel_id,
          denom,
          data,
        )

      // Empty shard cleanup burns the canonical shard NFT.
      BurnEscrowShard { channel_id, denom } ->
        validate_burn_escrow_shard(
          inputs,
          outputs,
          mint,
          transfer_escrow_shard_policy_id,
          channel_id,
          denom,
        )
    }
  }

  else(_) {
    fail
  }
}

fn validate_create_escrow_shard(
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  transfer_escrow_shard_policy_id: PolicyId,
  transfer_port_token: AuthToken,
  channel_id: ByteArray,
  denom: ByteArray,
  data: FungibleTokenPacketData,
) -> Bool {
  // Tie shard creation to the exact packet denom and amount.
  expect data.denom == denom
  expect fungible_token_packet_data.validate_basic(data)

  // Native escrow denoms are encoded Cardano token units.
  expect Some(escrowed_token_unit) = string_utils.hex_string_to_bytes(denom)
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  expect Some(transfer_amount) = int.from_utf8(data.amount)

  // Shard creation must consume the authenticated transfer module state. Its
  // out-ref is a one-shot nonce, so the resulting NFT cannot be replayed.
  expect [module_state_input] =
    list.filter(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(transfer_port_token) },
    )
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(
      channel_id,
      denom,
      module_state_input.output_reference,
    )
  let shard_token =
    AuthToken {
      policy_id: transfer_escrow_shard_policy_id,
      name: shard_token_name,
    }

  expect [created_output] =
    list.filter(
      outputs,
      fn(output) {
        and {
          output.address == module_state_input.output.address,
          output |> auth.contain_auth_token(shard_token),
        }
      },
    )
  expect InlineDatum(datum) = created_output.datum
  expect datum: TransferEscrowDatum = datum

  // Lovelace may exceed the packet amount because of min-ADA.
  let created_quantity =
    quantity_of(
      created_output.value,
      escrowed_token_policy_id,
      escrowed_token_name,
    )

  and {
    // Mint exactly one shard NFT and no other shard-policy tokens.
    tokens(mint, transfer_escrow_shard_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, 1)
    ),
    // The datum must match the shard NFT derivation inputs.
    datum == TransferEscrowDatum { channel_id, denom },
    escrow_shard_value_is_canonical(
      created_output,
      transfer_escrow_shard_policy_id,
      shard_token_name,
      escrowed_token_unit,
    )?,
    if escrowed_token_unit == "lovelace" {
      created_quantity >= transfer_amount
    } else {
      created_quantity == transfer_amount
    },
  }
}

fn validate_burn_escrow_shard(
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
) -> Bool {
  // Unique shard names include their creation input, so recover the NFT from
  // the consumed shard and bind its datum back to the burn redeemer.
  expect [spent_shard] =
    list.filter(
      inputs,
      fn(input) {
        !(input.output.value
          |> tokens(transfer_escrow_shard_policy_id)
          |> dict.is_empty)
      },
    )
  expect InlineDatum(spent_shard_data) = spent_shard.output.datum
  expect spent_shard_datum: TransferEscrowDatum = spent_shard_data
  expect spent_shard_datum == TransferEscrowDatum { channel_id, denom }
  expect [shard_token_name] =
    spent_shard.output.value
      |> tokens(transfer_escrow_shard_policy_id)
      |> dict.keys()
  expect
    quantity_of(
      spent_shard.output.value,
      transfer_escrow_shard_policy_id,
      shard_token_name,
    ) == 1
  let shard_token =
    AuthToken {
      policy_id: transfer_escrow_shard_policy_id,
      name: shard_token_name,
    }
  and {
    // Burn exactly one shard NFT and leave no successor shard.
    tokens(mint, transfer_escrow_shard_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, -1)
    ),
    list.is_empty(
      list.filter(
        outputs,
        fn(output) { output |> auth.contain_auth_token(shard_token) },
      ),
    ),
  }
}

fn escrow_shard_value_is_canonical(
  output: Output,
  shard_policy_id: PolicyId,
  shard_token_name: ByteArray,
  escrowed_token_unit: ByteArray,
) -> Bool {
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  let escrowed_quantity =
    quantity_of(output.value, escrowed_token_policy_id, escrowed_token_name)
  let shard_nft_value = assets.from_asset(shard_policy_id, shard_token_name, 1)
  let expected_non_lovelace =
    // Canonical shards contain no unrelated non-lovelace assets.
    if escrowed_token_unit == "lovelace" {
      shard_nft_value
    } else {
      assets.merge(
        shard_nft_value,
        assets.from_asset(
          escrowed_token_policy_id,
          escrowed_token_name,
          escrowed_quantity,
        ),
      )
    }
  assets.without_lovelace(output.value) == expected_non_lovelace
}
