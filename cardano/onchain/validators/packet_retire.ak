use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch.{Consolidate, RetireEmpty}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config
use ibc/utils/validator_utils

validator packet_retire(
  config_token: AuthToken,
  channel_policy: PolicyId,
  lane_policy: PolicyId,
  _client_policy: PolicyId,
  _connection_policy: PolicyId,
  lane_count: Int,
  _voucher_policy: PolicyId,
) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
    expect
      validator_utils.require_exact_marker_mint(transaction.mint, policy, "", 1)
    let config = packet_config.reference(transaction, config_token)
    let authorized =
      packet_batch.authorization(transaction, config.batch_policy)
    expect authorized.channel_token.policy_id == channel_policy
    expect config.state_policy == lane_policy && config.lane_count == lane_count
    let op = authorized.operation
    expect
      when op is {
        RetireEmpty { .. } | Consolidate { .. } -> True
        _ -> False
      }
    packet_batch.validate_retirement(transaction, config.batch_policy, op)
  }

  else(_) {
    fail
  }
}
