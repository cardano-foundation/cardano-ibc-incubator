use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output}
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

pub fn same_escrow_identity(
  left: TransferEscrowDatum,
  right: TransferEscrowDatum,
) -> Bool {
  and {
    left.channel_id == right.channel_id,
    left.denom == right.denom,
  }
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
  // Shard successors keep the script address and immutable `{channel_id, denom}`
  // identity. Their logical principal is expected to change on packet updates.
  // Check the derived NFT first so unrelated inline datums cannot abort shard lookup.
  if output.address != address || !escrow_shard_has_nft(
    output,
    datum,
    shard_policy_id,
  ) {
    False
  } else {
    when output.datum is {
      InlineDatum(data) -> {
        expect output_datum: TransferEscrowDatum = data
        same_escrow_identity(output_datum, datum)
      }
      _ -> False
    }
  }
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

pub fn transfer_escrow_datum(
  channel_id: ByteArray,
  denom: ByteArray,
) -> TransferEscrowDatum {
  transfer_escrow_datum_with_amount(channel_id, denom, 0)
}

pub fn transfer_escrow_datum_with_amount(
  channel_id: ByteArray,
  denom: ByteArray,
  escrowed_amount: Int,
) -> TransferEscrowDatum {
  TransferEscrowDatum { channel_id, denom, escrowed_amount }
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
  and {
    datum.escrowed_amount >= 0,
    assets.match_assets(output.value, expected_non_lovelace),
    if escrowed_token_unit == "lovelace" {
      // Physical lovelace also carries the shard's minimum-UTxO reserve.
      escrowed_quantity >= datum.escrowed_amount
    } else {
      escrowed_quantity == datum.escrowed_amount
    },
  }
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
      fn(output) {
        escrow_output_matches(output, address, datum, shard_policy_id)
      },
    )
  expect created_datum: TransferEscrowDatum =
    validator_utils.get_inline_datum(created_output)
  and {
    same_escrow_identity(created_datum, datum),
    created_datum.escrowed_amount == transfer_amount,
    quantity_of(mint, shard_policy_id, escrow_shard_token_name(datum)) == 1,
    escrow_value_is_single_asset(
      created_output,
      created_datum,
      shard_policy_id,
      escrowed_token_unit,
    )?,
  }
}

fn validate_escrow_shard_update(
  spent_input: Input,
  spend: TransferModuleSpend,
  expected_datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  principal_delta: Int,
  expected_value_difference: Value,
  escrowed_token_unit: ByteArray,
) -> Bool {
  expect EscrowShard { datum, updated_output } = spend
  expect same_escrow_identity(datum, expected_datum)

  let expected_escrowed_amount = datum.escrowed_amount + principal_delta
  let shard_token_name = escrow_shard_token_name(expected_datum)
  let shard_mint_quantity = quantity_of(mint, shard_policy_id, shard_token_name)

  and {
    // Validate shard canonicality before balance arithmetic.
    escrow_shard_has_nft(spent_input.output, expected_datum, shard_policy_id)?,
    escrow_value_is_single_asset(
      spent_input.output,
      datum,
      shard_policy_id,
      escrowed_token_unit,
    )?,
    // The signed principal delta models send as positive and refund/unescrow as
    // negative. Physical ADA is deliberately not used as the logical balance.
    if expected_escrowed_amount >= 0 {
      // Empty and non-empty shards both retain their successor and NFT.
      expect Some(output) = updated_output
      expect output_datum: TransferEscrowDatum =
        validator_utils.get_inline_datum(output)
      and {
        same_escrow_identity(output_datum, datum),
        output_datum.escrowed_amount == expected_escrowed_amount,
        shard_mint_quantity == 0,
        value_delta.validate_output_amount(
          spent_input,
          output,
          expected_value_difference,
        )?,
        escrow_value_is_single_asset(
          output,
          output_datum,
          shard_policy_id,
          escrowed_token_unit,
        )?,
      }
    } else {
      False
    },
  }
}

fn validate_matching_escrow_input_update(
  escrow_input: Input,
  outputs: List<Output>,
  datum: TransferEscrowDatum,
  shard_policy_id: PolicyId,
  mint: Value,
  principal_delta: Int,
  expected_value_difference: Value,
  escrowed_token_unit: ByteArray,
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
    principal_delta,
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
    ModuleState { updated_output, datum_changed } -> {
      // Root spends are lifecycle/setup state; any native packet-side escrow effect
      // must still be witnessed by the matching shard update or creation.
      let preserved_module_state =
        value_delta.validate_output_amount(
          spent_input,
          updated_output,
          assets.zero,
        )
      let matching_escrow_input =
        find_matching_escrow_input(
          inputs,
          spent_input.output.address,
          datum,
          shard_policy_id,
        )
      let shard_mint_quantity =
        quantity_of(mint, shard_policy_id, escrow_shard_token_name(datum))
      // The mint policy validates the typed Merkle update; this callback only
      // permits the module datum to change alongside that exact first mint.
      let registry_transition_is_authorized =
        if datum_changed {
          shard_mint_quantity == 1
        } else {
          shard_mint_quantity == 0
        }

      and {
        preserved_module_state?,
        registry_transition_is_authorized?,
        when matching_escrow_input is {
          Some(escrow_input) ->
            validate_matching_escrow_input_update(
              escrow_input,
              outputs,
              datum,
              shard_policy_id,
              mint,
              transfer_amount,
              expected_value_difference,
              escrowed_token_unit,
            )
          // Only a positive native send may create a previously absent shard.
          None ->
            transfer_amount > 0 && validate_created_escrow_shard(
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
    }
    EscrowShard { .. } ->
      // Shard spend is the native packet witness.
      validate_escrow_shard_update(
        spent_input,
        spend,
        datum,
        shard_policy_id,
        mint,
        transfer_amount,
        expected_value_difference,
        escrowed_token_unit,
      )
  }
}
