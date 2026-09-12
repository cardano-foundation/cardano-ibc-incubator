use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{Input, Output}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/value_delta
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

pub type TransferModuleSpend {
  // Setup/lifecycle spend of the transfer module root.
  ModuleState { updated_output: Output, datum_changed: Bool }
  // Escrow shards always retain a successor so their NFT cannot be re-minted.
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
  shard_policy_id: PolicyId,
) -> Bool {
  output.address == address && escrow_shard_has_nft(
    output,
    datum,
    shard_policy_id,
  )
}

fn find_escrow_output(
  outputs: List<Output>,
  spent_output: Output,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
) -> Option<Output> {
  // A shard has at most one successor with the same address and datum.
  when
    list.filter(
      outputs,
      fn(output) {
        escrow_output_matches(
          output,
          spent_output.address,
          datum,
          shard_policy_id,
        )
      },
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
  shard_policy_id: PolicyId,
) -> TransferModuleSpend {
  // Root state is identified by both module auth tokens; everything else must be
  // an escrow shard with an inline shard datum.
  if has_module_state_tokens(spent_output, port_token, module_token) {
    // Root state spends must preserve the root token set at the full original
    // address. Otherwise a public callback could relocate both capabilities to
    // an attacker-controlled validator and transfer authority for the port.
    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) {
          output.address == spent_output.address && has_module_state_tokens(
            output,
            port_token,
            module_token,
          )
        },
      )
    ModuleState {
      updated_output,
      datum_changed: spent_output.datum != updated_output.datum,
    }
  } else {
    // Non-root transfer spends are escrow shards.
    expect datum: TransferEscrowDatum =
      validator_utils.get_inline_datum(spent_output)
    expect escrow_shard_has_nft(spent_output, datum, shard_policy_id)
    let updated_output =
      find_escrow_output(outputs, spent_output, datum, shard_policy_id)
    EscrowShard { datum, updated_output }
  }
}

pub fn expect_module_state(spend: TransferModuleSpend) -> Output {
  expect ModuleState { updated_output, datum_changed } = spend
  expect !datum_changed
  updated_output
}

pub fn validate_preserved_module_state(
  spent_input: Input,
  spend: TransferModuleSpend,
) -> Bool {
  value_delta.validate_output_value(
    expect_module_state(spend),
    spent_input.output.value,
  )
}

pub fn transfer_escrow_datum(
  channel_id: ByteArray,
  denom: ByteArray,
) -> TransferEscrowDatum {
  TransferEscrowDatum { channel_id, denom, escrowed_amount: 0 }
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
  shard_policy_id: PolicyId,
) -> Option<Input> {
  when
    list.filter(
      inputs,
      fn(input) {
        escrow_output_matches(input.output, address, datum, shard_policy_id)
      },
    )
  is {
    [] -> None
    [escrow_input] -> Some(escrow_input)
    _ -> fail @"Multiple matching transfer escrow inputs"
  }
}

fn validate_created_escrow_shard(
  outputs: List<Output>,
  address: Address,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  transfer_amount: Int,
) -> Bool {
  // First native send creates a canonical shard and mints exactly one shard NFT.
  expect [created_output] =
    list.filter(
      outputs,
      fn(output) {
        escrow_output_matches(output, address, datum, shard_policy_id)
      },
    )
  expect created_datum: TransferEscrowDatum =
    validator_utils.get_inline_datum(created_output)
  // The shard mint policy validates its value and canonical asset inventory.
  // Bind that mandatory mint to this packet's identity and deposit amount.
  and {
    quantity_of(mint, shard_policy_id, escrow_shard_token_name(datum)) == 1,
    created_datum == TransferEscrowDatum {
      ..datum,
      escrowed_amount: transfer_amount,
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
  transfer_amount: Int,
) -> Bool {
  expect EscrowShard { datum, updated_output } = spend
  expect datum.channel_id == expected_datum.channel_id
  expect datum.denom == expected_datum.denom

  let accounted_amount = datum.escrowed_amount + transfer_amount
  let shard_token_name = escrow_shard_token_name(expected_datum)
  let shard_mint_quantity = quantity_of(mint, shard_policy_id, shard_token_name)

  // The signed value delta models send as positive and refund/unescrow as negative.
  if accounted_amount >= 0 {
    // Empty and non-empty shards both retain their successor and NFT.
    expect Some(output) = updated_output
    expect updated_datum: TransferEscrowDatum =
      validator_utils.get_inline_datum(output)
    and {
      updated_datum == TransferEscrowDatum {
        ..datum,
        escrowed_amount: accounted_amount,
      },
      shard_mint_quantity == 0,
      value_delta.validate_output_amount(
        spent_input,
        output,
        expected_value_difference,
      )?,
    }
  } else {
    False
  }
}

fn validate_matching_escrow_input_update(
  escrow_input: Input,
  outputs: List<Output>,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  expected_value_difference: Value,
  transfer_amount: Int,
) -> Bool {
  let updated_output =
    find_escrow_output(outputs, escrow_input.output, datum, shard_policy_id)
  expect input_datum: TransferEscrowDatum =
    validator_utils.get_inline_datum(escrow_input.output)
  validate_escrow_shard_update(
    escrow_input,
    EscrowShard { datum: input_datum, updated_output },
    datum,
    shard_policy_id,
    mint,
    expected_value_difference,
    transfer_amount,
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
) -> Bool {
  when spend is {
    ModuleState { updated_output, datum_changed } -> {
      // Root spends are lifecycle/setup state; any native packet-side escrow effect
      // must still be witnessed by the matching shard update or creation.
      let preserved_module_state =
        value_delta.validate_output_value(
          updated_output,
          spent_input.output.value,
        )
      let matching_escrow_input =
        find_matching_escrow_input(
          inputs,
          spent_input.output.address,
          datum,
          shard_policy_id,
        )
      and {
        preserved_module_state?,
        when matching_escrow_input is {
          Some(escrow_input) ->
            !datum_changed && validate_matching_escrow_input_update(
              escrow_input,
              outputs,
              datum,
              shard_policy_id,
              mint,
              expected_value_difference,
              transfer_amount,
            )
          // The shard mint policy requires a positive initial deposit.
          None ->
            datum_changed && validate_created_escrow_shard(
              outputs,
              spent_input.output.address,
              datum,
              shard_policy_id,
              mint,
              transfer_amount,
            )
        },
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
        transfer_amount,
      )
  }
}
