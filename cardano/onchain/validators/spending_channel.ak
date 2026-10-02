use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{ReclaimChannel, SpendChannelRedeemer}
use ibc/core/ics_004/packet_shutdown
use ibc/implementation/spending_channel as implementation

validator spend_channel(
  packet_config_policy: PolicyId,
  chan_open_ack_policy_id: PolicyId,
  chan_open_confirm_policy_id: PolicyId,
  chan_close_init_policy_id: PolicyId,
  chan_close_confirm_policy_id: PolicyId,
  recv_packet_policy_id: PolicyId,
  send_packet_policy_id: PolicyId,
  timeout_packet_policy_id: PolicyId,
  acknowledge_packet_policy_id: PolicyId,
  prune_packet_history_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  spend(
    optional_datum: Option<ChannelDatum>,
    redeemer: SpendChannelRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect
      if redeemer == ReclaimChannel {
        expect Some(datum) = optional_datum
        datum.port_id != "transfer" || packet_shutdown.channel_drained(
          transaction,
          packet_config_policy,
          datum,
        )
      } else {
        True
      }
    implementation.validate(
      True,
      chan_open_ack_policy_id,
      chan_open_confirm_policy_id,
      chan_close_init_policy_id,
      chan_close_confirm_policy_id,
      recv_packet_policy_id,
      send_packet_policy_id,
      timeout_packet_policy_id,
      acknowledge_packet_policy_id,
      prune_packet_history_policy_id,
      host_state_nft_policy_id,
      optional_datum,
      redeemer,
      spent_output_ref,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
