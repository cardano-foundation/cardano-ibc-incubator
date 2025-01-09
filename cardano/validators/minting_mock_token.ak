use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}

validator mint_mock_token {
  mint(_redeemer: Data, _policy_id: PolicyId, _transaction: Transaction) {
    True
  }

  else(_) {
    fail
  }
}
