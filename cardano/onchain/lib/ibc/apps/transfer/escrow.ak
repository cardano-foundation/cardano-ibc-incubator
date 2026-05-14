use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/value_delta
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

pub type TransferModuleSpend {
  // Setup/lifecycle spend of the transfer module root.
  ModuleState(Output)
  // `None` successor means the shard is emptied and its NFT must burn.
  EscrowShard { datum: TransferEscrowDatum, updated_output: Option<Output> }
}

pub fn has_module_state_tokens(
  output: Output,
  port_token: AuthToken,
  module_token: AuthToken,
) -> Bool {
  and {
    auth.contain_auth_token(output, port_token),
    auth.contain_auth_token(output, module_token),
  }
}

fn escrow_output_matches(
  output: Output,
  address: Address,
  datum: TransferEscrowDatum,
) -> Bool {
  // Shard successors keep the script address and exact `{channel_id, denom}` datum.
  if output.address != address {
    False
  } else {
    when output.datum is {
      InlineDatum(data) -> {
        expect output_datum: TransferEscrowDatum = data
        output_datum == datum
      }
      _ -> False
    }
  }
}

fn find_escrow_output(
  outputs: List<Output>,
  spent_output: Output,
  datum: TransferEscrowDatum,
) -> Option<Output> {
  // A shard has at most one successor with the same address and datum.
  when
    list.filter(
      outputs,
      fn(output) { escrow_output_matches(output, spent_output.address, datum) },
    )
  is {
    [] -> None
    [updated_output] -> Some(updated_output)
    _ -> fail @"Multiple matching transfer escrow outputs"
  }
}

pub fn classify_transfer_module_spend(
  spent_output: Output,
  outputs: List<Output>,
  port_token: AuthToken,
  module_token: AuthToken,
) -> TransferModuleSpend {
  // Root state is identified by both module auth tokens; everything else must be
  // an escrow shard with an inline shard datum.
  if has_module_state_tokens(spent_output, port_token, module_token) {
    // Root state spends must preserve the root token set.
    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { has_module_state_tokens(output, port_token, module_token) },
      )
    expect NoDatum = updated_output.datum
    ModuleState(updated_output)
  } else {
    // Non-root transfer spends are escrow shards.
    expect datum: TransferEscrowDatum =
      validator_utils.get_inline_datum(spent_output)
    let updated_output = find_escrow_output(outputs, spent_output, datum)
    EscrowShard { datum, updated_output }
  }
}

pub fn expect_module_state(spend: TransferModuleSpend) -> Output {
  expect ModuleState(updated_output) = spend
  updated_output
}

pub fn transfer_escrow_datum(
  channel_id: ByteArray,
  denom: ByteArray,
) -> TransferEscrowDatum {
  TransferEscrowDatum { channel_id, denom }
}

pub fn escrow_shard_token_name(datum: TransferEscrowDatum) -> ByteArray {
  transfer_escrow_shard.shard_token_name(datum.channel_id, datum.denom)
}

pub fn escrow_shard_has_nft(
  output: Output,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
) -> Bool {
  // Shard NFT name is derived from the datum.
  quantity_of(output.value, shard_policy_id, escrow_shard_token_name(datum)) == 1
}

fn find_matching_escrow_input(
  inputs: List<Input>,
  address: Address,
  datum: TransferEscrowDatum,
) -> Option<Input> {
  when
    list.filter(
      inputs,
      fn(input) { escrow_output_matches(input.output, address, datum) },
    )
  is {
    [] -> None
    [escrow_input] -> Some(escrow_input)
    _ -> fail @"Multiple matching transfer escrow inputs"
  }
}

fn escrow_value_is_single_asset(
  output: Output,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  escrowed_token_unit: ByteArray,
) -> Bool {
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  let escrowed_quantity =
    quantity_of(output.value, escrowed_token_policy_id, escrowed_token_name)
  let shard_nft_value =
    assets.from_asset(shard_policy_id, escrow_shard_token_name(datum), 1)
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
  assets.match_assets(output.value, expected_non_lovelace)
}

fn validate_created_escrow_shard(
  outputs: List<Output>,
  address: Address,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  transfer_amount: Int,
  escrowed_token_unit: ByteArray,
) -> Bool {
  // First native send creates a canonical shard and mints exactly one shard NFT.
  expect [created_output] =
    list.filter(
      outputs,
      fn(output) { escrow_output_matches(output, address, datum) },
    )
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  let created_quantity =
    quantity_of(
      created_output.value,
      escrowed_token_policy_id,
      escrowed_token_name,
    )
  and {
    escrow_shard_has_nft(created_output, datum, shard_policy_id)?,
    quantity_of(mint, shard_policy_id, escrow_shard_token_name(datum)) == 1,
    escrow_value_is_single_asset(
      created_output,
      datum,
      shard_policy_id,
      escrowed_token_unit,
    )?,
    if escrowed_token_unit == "lovelace" {
      // Lovelace shards may carry extra ADA for minimum-UTxO requirements.
      created_quantity >= transfer_amount
    } else {
      created_quantity == transfer_amount
    },
  }
}

fn validate_escrow_shard_update(
  spent_input: Input,
  spend: TransferModuleSpend,
  expected_datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  expected_value_difference: Value,
  escrowed_token_unit: ByteArray,
) -> Bool {
  expect EscrowShard { datum, updated_output } = spend
  expect datum == expected_datum

  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  let expected_output =
    spent_input.output.value
      |> assets.merge(expected_value_difference)
  let expected_escrow_quantity =
    quantity_of(expected_output, escrowed_token_policy_id, escrowed_token_name)
  let shard_token_name = escrow_shard_token_name(expected_datum)
  let shard_mint_quantity = quantity_of(mint, shard_policy_id, shard_token_name)

  and {
    // Validate shard canonicality before balance arithmetic.
    escrow_shard_has_nft(spent_input.output, expected_datum, shard_policy_id)?,
    escrow_value_is_single_asset(
      spent_input.output,
      expected_datum,
      shard_policy_id,
      escrowed_token_unit,
    )?,
    // The signed value delta models send as positive and refund/unescrow as negative.
    if expected_escrow_quantity < 0 {
      False
    } else if expected_escrow_quantity == 0 {
      // Empty shards have no successor and burn the NFT.
      when updated_output is {
        None -> shard_mint_quantity == -1
        Some(_) -> False
      }
    } else {
      // Non-empty shards keep their NFT and datum.
      expect Some(output) = updated_output
      and {
        shard_mint_quantity == 0,
        escrow_shard_has_nft(output, expected_datum, shard_policy_id)?,
        value_delta.validate_output_amount(
          spent_input,
          output,
          expected_value_difference,
        )?,
        escrow_value_is_single_asset(
          output,
          expected_datum,
          shard_policy_id,
          escrowed_token_unit,
        )?,
      }
    },
  }
}

fn validate_matching_escrow_input_update(
  escrow_input: Input,
  outputs: List<Output>,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  expected_value_difference: Value,
  escrowed_token_unit: ByteArray,
) -> Bool {
  let updated_output = find_escrow_output(outputs, escrow_input.output, datum)
  validate_escrow_shard_update(
    escrow_input,
    EscrowShard { datum, updated_output },
    datum,
    shard_policy_id,
    mint,
    expected_value_difference,
    escrowed_token_unit,
  )
}

pub fn validate_module_escrow_transition(
  spent_input: Input,
  spend: TransferModuleSpend,
  inputs: List<Input>,
  outputs: List<Output>,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  transfer_amount: Int,
  expected_value_difference: Value,
  escrowed_token_unit: ByteArray,
) -> Bool {
  when spend is {
    ModuleState(updated_output) -> {
      // Root spends are lifecycle/setup state; any native packet-side escrow effect
      // must still be witnessed by the matching shard update or creation.
      let preserved_module_state =
        value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )
      let matching_escrow_input =
        find_matching_escrow_input(inputs, spent_input.output.address, datum)

      if transfer_amount > 0 {
        // Positive native sends update or create the shard.
        and {
          preserved_module_state?,
          when matching_escrow_input is {
            Some(escrow_input) ->
              validate_matching_escrow_input_update(
                escrow_input,
                outputs,
                datum,
                shard_policy_id,
                mint,
                expected_value_difference,
                escrowed_token_unit,
              )
            None ->
              validate_created_escrow_shard(
                outputs,
                spent_input.output.address,
                datum,
                shard_policy_id,
                mint,
                transfer_amount,
                escrowed_token_unit,
              )
          },
        }
      } else {
        // Native refunds/unescrows require an existing shard.
        when matching_escrow_input is {
          Some(escrow_input) -> and {
              preserved_module_state?,
              validate_matching_escrow_input_update(
                escrow_input,
                outputs,
                datum,
                shard_policy_id,
                mint,
                expected_value_difference,
                escrowed_token_unit,
              )?,
            }
          None -> False
        }
      }
    }
    EscrowShard { .. } ->
      // Shard spend is the native packet witness.
      validate_escrow_shard_update(
        spent_input,
        spend,
        datum,
        shard_policy_id,
        mint,
        expected_value_difference,
        escrowed_token_unit,
      )
  }
}
