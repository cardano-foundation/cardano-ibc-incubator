use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch.{Acknowledge}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config
use ibc/utils/validator_utils

validator packet_acknowledge(
  config_token: AuthToken,
  channel_policy: PolicyId,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  voucher_policy: PolicyId,
  verify_policy: PolicyId,
) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
    expect
      validator_utils.require_exact_marker_mint(transaction.mint, policy, "", 1)
    let config = packet_config.reference(transaction, config_token)
    let authorized =
      packet_batch.authorization(transaction, config.batch_policy)
    expect authorized.channel_token.policy_id == channel_policy
    expect config.state_policy == lane_policy && config.lane_count == lane_count
    expect Acknowledge { packet, proof_height, proof, lane } =
      authorized.operation
    let op = Acknowledge { packet, proof_height, proof, lane }
    packet_batch.validate_settlement(
      transaction,
      config.batch_policy,
      authorized.channel_token,
      lane_policy,
      client_policy,
      connection_policy,
      lane_count,
      voucher_policy,
      op,
      verify_policy,
    )
  }

  else(_) {
    fail
  }
}
