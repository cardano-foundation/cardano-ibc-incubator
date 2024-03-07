use aiken/list
use aiken/transaction.{ScriptContext, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  Other, SpendClientRedeemer, UpdateClient,
}
use ibc/utils/validator_utils

validator {
  fn spend_client(
    datum: ClientDatum,
    redeemer: SpendClientRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, .. } = transaction

    //========================valid input=======================
    // input contains client token
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains client token
    expect updated_output |> auth.contain_auth_token(datum.token)

    // TODO: add verify header
    // output datum is updated correctly
    expect updated_datum: ClientDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      UpdateClient(header) ->
        client_datum.is_updated_valid(datum, updated_datum, header)
      Other -> False
    }
  }
}
