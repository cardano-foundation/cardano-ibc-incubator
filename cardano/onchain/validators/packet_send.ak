use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch.{SendBatch}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/utils/validator_utils

validator packet_send(
  config_token: AuthToken,
  channel_policy: PolicyId,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
  voucher_policy: PolicyId,
) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
    expect
      validator_utils.require_exact_marker_mint(transaction.mint, policy, "", 1)
    let config = packet_config.reference(transaction, config_token)
    expect packet_config.active(transaction, config.host_policy)
    let authorized =
      packet_batch.authorization(transaction, config.batch_policy)
    expect authorized.channel_token.policy_id == channel_policy
    expect config.state_policy == lane_policy && config.lane_count == lane_count
    expect SendBatch { sequencer_ref, intents, packets, lanes } =
      authorized.operation
    let op = SendBatch { sequencer_ref, intents, packets, lanes }
    expect sequencer: SendSequencerDatum =
      validator_utils.get_inline_datum(
        packet_batch.input_at(transaction, sequencer_ref).output,
      )
    let token =
      AuthToken {
        policy_id: lane_policy,
        name: packet_lanes.sequencer_token_name(
          sequencer.port_id,
          sequencer.channel_id,
        ),
      }
    packet_batch.validate_send(
      transaction,
      config.batch_policy,
      authorized.channel_token,
      token,
      lane_policy,
      client_policy,
      connection_policy,
      lane_count,
      voucher_policy,
      op,
    )
  }

  else(_) {
    fail
  }
}
