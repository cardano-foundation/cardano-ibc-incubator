use aiken/transaction.{ScriptContext}
use ibc/apps/mock/datum.{MockModuleDatum}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer}
use ibc/utils/validator_utils

validator {
  fn spend_mock_module(
    _datum: MockModuleDatum,
    _redeemer: IBCModuleRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)

    expect Some(_) =
      validator_utils.validate_token_remain(
        spent_output,
        transaction.outputs,
        [],
      )

    True
  }
}
