use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/utils/shutdown

validator voucher_metadata(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Void,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    shutdown.reclaim(
      transaction,
      own_ref,
      host_state_nft_policy_id,
      assets.zero,
    )
  }

  else(_) {
    fail
  }
}
