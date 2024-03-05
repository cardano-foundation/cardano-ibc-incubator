use aiken/dict.{Dict}
use aiken/list
use aiken/transaction.{Mint, Redeemer, ScriptContext, ScriptPurpose}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  CreateClient, HandlerOperator, Other,
}
use ibc/utils/validator_utils

validator(mint_client_policy_id: PolicyId) {
  fn spend_handler(
    datum: HandlerDatum,
    redeemer: HandlerOperator,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, _, outputs, redeemers) =
      validator_utils.extract_spending_context(context)

    //========================valid input=======================
    // input contains handler token
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains handler token
    expect updated_output |> auth.contain_auth_token(datum.token)

    // output datum is updated correctly
    expect updated_datum: HandlerDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      CreateClient -> {
        expect update_valid_handler(datum, updated_datum)
        expect mint_valid_client(redeemers, datum.token, mint_client_policy_id)
        True
      }
      Other -> False
    }
  }
}

fn update_valid_handler(
  input_datum: HandlerDatum,
  output_datum: HandlerDatum,
) -> Bool {
  expect handler_datum.is_client_created_valid(input_datum, output_datum)
  True
}

fn mint_valid_client(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_auth_token: AuthToken,
  mint_client_policy_id: PolicyId,
) -> Bool {
  // mint client redeemer is MintNewClient operator
  expect Some(mint_client_redeemer) =
    redeemers |> dict.get(Mint(mint_client_policy_id))
  expect mint_client_redeemer: MintClientRedeemer = mint_client_redeemer
  expect mint_client_redeemer == MintClientRedeemer { handler_auth_token }
  True
}
