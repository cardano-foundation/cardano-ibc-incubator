use aiken/transaction.{ScriptContext}

validator {
  fn refer_only(_datum: Void, _redeemer: Void, _context: ScriptContext) -> Bool {
    False
  }
}
