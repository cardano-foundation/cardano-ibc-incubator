use aiken/bytearray
use aiken/dict.{Dict}
use aiken/interval.{Finite}
use aiken/list
use aiken/time.{PosixTime}
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, Redeemer, ScriptContext, ScriptPurpose,
  Spend, Transaction, ValidityRange,
}
use aiken/transaction/value.{AssetName, MintedValue, PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/core/ics_002_client_semantics/types/keys as client_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{HandlerOperator}

pub fn get_inline_datum(output: Output) -> Data {
  expect InlineDatum(data) = output.datum
  data
}

pub fn extract_minting_context(
  context: ScriptContext,
) -> (ByteArray, List<Input>, List<Output>, MintedValue) {
  let ScriptContext { transaction, purpose } = context
  expect Mint(policy_id) = purpose
  let Transaction { inputs, outputs, mint, .. } = transaction
  (policy_id, inputs, outputs, mint)
}

pub fn extract_spending_context(context: ScriptContext) -> (Output, Transaction) {
  let ScriptContext { transaction, purpose } = context
  let Transaction { inputs, .. } = transaction

  expect Spend(spent_ref) = purpose
  expect Some(spent_input) = transaction.find_input(inputs, spent_ref)
  let spent_output = spent_input.output

  (spent_output, transaction)
}

pub fn quantity_token_output(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  outputs
    |> list.reduce(
         0,
         fn(prev, cur) {
           prev + (
             cur.value
               |> value.quantity_of(policy_id, asset_name)
           )
         },
       )
}

pub fn quantity_token_input(
  inputs: List<Input>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  inputs
    |> list.map(fn(input) { input.output })
    |> quantity_token_output(policy_id, asset_name)
}

pub fn get_tx_valid_to(validity_range: ValidityRange) -> PosixTime {
  let upper_bound = validity_range.upper_bound

  // TODO: unable to set this value with Lucid
  // expect upper_bound.is_inclusive
  expect Finite(valid_to) = upper_bound.bound_type

  valid_to
}

pub fn get_tx_valid_from(validity_range: ValidityRange) -> Option<PosixTime> {
  let lower_bound = validity_range.lower_bound

  if lower_bound.is_inclusive {
    when lower_bound.bound_type is {
      Finite(valid_from) -> Some(valid_from)
      _ -> None
    }
  } else {
    None
  }
}

pub fn validate_handler_redeemer(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  expected_redeemer: HandlerOperator,
) -> Option<HandlerDatum> {
  when
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(handler_token) },
    )
  is {
    Some(handler_input) ->
      when dict.get(redeemers, Spend(handler_input.output_reference)) is {
        Some(spent_handler_redeemer) -> {
          expect handler_operator: HandlerOperator = spent_handler_redeemer
          if handler_operator == expected_redeemer {
            let handler_output = handler_input.output
            expect handler_datum: HandlerDatum =
              get_inline_datum(handler_output)
            Some(handler_datum)
          } else {
            None
          }
        }
        None -> None
      }
    None -> None
  }
}

pub fn extract_module_redeemer(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_token_name: ByteArray,
  port_minting_policy_id: PolicyId,
  port_id: ByteArray,
) -> Option<IBCModuleRedeemer> {
  let port_number = port_keys.parse_port_id_number(port_id)
  let port_token_name =
    auth.generate_token_name_from_another(
      channel_token_name,
      port_keys.port_prefix,
      port_number,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  expect [module_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, port_token) },
    )

  expect Some(spent_module_redeemer) =
    dict.get(redeemers, Spend(module_input.output_reference))
  expect ibc_module_redeemer: IBCModuleRedeemer = spent_module_redeemer

  Some(ibc_module_redeemer)
}

pub fn validate_referred_client(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  client_id: ByteArray,
) -> Option<ClientDatum> {
  let client_sequence = client_keys.parse_client_id_sequence(client_id)

  let client_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      client_keys.client_prefix,
      client_sequence,
    )
  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  when
    list.find(
      reference_inputs,
      fn(input) { input.output |> auth.contain_auth_token(client_token) },
    )
  is {
    Some(client_input) -> {
      expect client_datum: ClientDatum = get_inline_datum(client_input.output)
      Some(client_datum)
    }
    None -> None
  }
}

pub fn validate_referred_connection(
  reference_inputs: List<Input>,
  referrer_token_name: ByteArray,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> Option<ConnectionDatum> {
  let connection_sequence =
    connection_keys.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name_from_another(
      referrer_token_name,
      connection_keys.connection_prefix,
      connection_sequence,
    )
  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  when
    list.find(
      reference_inputs,
      fn(input) { input.output |> auth.contain_auth_token(connection_token) },
    )
  is {
    Some(connection_input) -> {
      expect connection_datum: ConnectionDatum =
        get_inline_datum(connection_input.output)
      Some(connection_datum)
    }
    None -> None
  }
}

pub fn validate_mint(
  mint: MintedValue,
  minting_policy_id: PolicyId,
  handler_token: AuthToken,
  token_name_prefix: ByteArray,
  sequence: Int,
) -> Option<AuthToken> {
  let token_name =
    auth.generate_token_name(handler_token, token_name_prefix, sequence)

  let token = AuthToken { policy_id: minting_policy_id, name: token_name }

  if auth.mint_auth_token(mint, token) {
    Some(token)
  } else {
    None
  }
}

pub fn validate_token_remain(
  spent_output: Output,
  outputs: List<Output>,
  tokens: List<AuthToken>,
) -> Option<Output> {
  when
    list.filter(outputs, fn(output) { output.address == spent_output.address })
  is {
    [updated_output] -> {
      let is_remain =
        if list.length(tokens) == 0 {
          value.without_lovelace(spent_output.value) == value.without_lovelace(
            updated_output.value,
          )
        } else {
          list.all(
            tokens,
            fn(token) {
              value.quantity_of(spent_output.value, token.policy_id, token.name) == value.quantity_of(
                updated_output.value,
                token.policy_id,
                token.name,
              )
            },
          )
        }

      if is_remain {
        Some(updated_output)
      } else {
        None
      }
    }
    _ -> None
  }
}

pub fn compare_purpose(_key1: ScriptPurpose, _key2: ScriptPurpose) -> Ordering {
  Greater
}

pub fn extract_token_unit(unit: ByteArray) -> Option<(ByteArray, ByteArray)> {
  let len = bytearray.length(unit)

  if unit == "lovelace" {
    Some((value.ada_policy_id, value.ada_asset_name))
  } else if 28 <= len && len <= 60 {
    let policy_id = bytearray.take(unit, 28)
    let name = bytearray.slice(unit, 28, 59)

    Some((policy_id, name))
  } else {
    None
  }
}

pub fn compare_script_purpose(
  _key1: ScriptPurpose,
  _key2: ScriptPurpose,
) -> Ordering {
  Greater
}
