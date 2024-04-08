use aiken/transaction.{ScriptContext}

validator {
  fn mint_mock_token(_redeemer: Data, _context: ScriptContext) -> Bool {
    True
  }
}
