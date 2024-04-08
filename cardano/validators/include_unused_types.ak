use aiken/transaction.{ScriptContext}
use ibc/apps/transfer/transfer_module_redeemer.{TransferModuleRedeemer}

validator {
  fn include_unused_types(
    _datum: Void,
    _redeemer: TransferModuleRedeemer,
    _context: ScriptContext,
  ) -> Bool {
    False
  }
}
