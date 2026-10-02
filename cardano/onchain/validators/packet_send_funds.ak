use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config
use ibc/utils/validator_utils

validator packet_send_funds(config_token: AuthToken, voucher_policy: PolicyId) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
    expect
      validator_utils.require_exact_marker_mint(transaction.mint, policy, "", 1)
    let config = packet_config.reference(transaction, config_token)
    let authorized =
      packet_batch.authorization(transaction, config.batch_policy)
    packet_batch.validate_send_funds(
      transaction,
      config.batch_policy,
      voucher_policy,
      authorized.operation,
    )
  }

  else(_) {
    fail
  }
}
