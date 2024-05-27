use aiken/transaction.{ScriptContext}
use ibc/apps/mock/datum.{MockModuleDatum}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer}

validator {
  fn spend_mock_module(
    _datum: MockModuleDatum,
    _redeemer: IBCModuleRedeemer,
    _context: ScriptContext,
  ) -> Bool {
    True
  }
}
