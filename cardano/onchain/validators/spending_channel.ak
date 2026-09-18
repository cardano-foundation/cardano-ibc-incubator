use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{SpendChannelRedeemer}
use ibc/implementation/spending_channel as implementation

validator spend_channel(
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
