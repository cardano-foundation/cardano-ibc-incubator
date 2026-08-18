use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Mint, Output, OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, ChanCloseConfirm, ChanCloseInit, ChanOpenAck,
  ChanOpenConfirm, RecvPacket, SendPacket, SpendChannelRedeemer, TimeoutPacket,
}
use ibc/utils/validator_utils

validator spend_channel(
  chan_open_ack_policy_id: PolicyId,
  chan_open_confirm_policy_id: PolicyId,
  chan_close_init_policy_id: PolicyId,
  chan_close_confirm_policy_id: PolicyId,
  recv_packet_policy_id: PolicyId,
  send_packet_policy_id: PolicyId,
  timeout_packet_policy_id: PolicyId,
  acknowledge_packet_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  spend(
    optional_datum: Option<ChannelDatum>,
    redeemer: SpendChannelRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, .. } = transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect Some(datum) = optional_datum
    let spent_output = spent_input.output

    when redeemer is {
      ChanOpenAck { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          chan_open_ack_policy_id,
          validator_utils.ExpectUpdateChannel,
          True,
        )
      ChanOpenConfirm { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          chan_open_confirm_policy_id,
          validator_utils.ExpectUpdateChannel,
          True,
        )
      ChanCloseInit ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          chan_close_init_policy_id,
          validator_utils.ExpectUpdateChannel,
          True,
        )
      ChanCloseConfirm { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          chan_close_confirm_policy_id,
          validator_utils.ExpectUpdateChannel,
          False,
        )
      RecvPacket { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          recv_packet_policy_id,
          validator_utils.ExpectHandlePacket,
          True,
        )
      SendPacket { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          send_packet_policy_id,
          validator_utils.ExpectHandlePacket,
          True,
        )
      TimeoutPacket { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          timeout_packet_policy_id,
          validator_utils.ExpectHandlePacket,
          True,
        )
      AcknowledgePacket { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          acknowledge_packet_policy_id,
          validator_utils.ExpectHandlePacket,
          True,
        )
    }
  }

  else(_) {
    fail
  }
}

fn validate_operation_witness(
  transaction: Transaction,
  spent_output: Output,
  channel_token: AuthToken,
  host_state_nft_policy_id: PolicyId,
  operation_policy_id: PolicyId,
  expected_host_state_redeemer: validator_utils.ExpectedHostStateRedeemer,
  requires_continuation: Bool,
) -> Bool {
  let Transaction { inputs, mint, redeemers, outputs, .. } = transaction

  expect _ =
    validator_utils.require_host_state_redeemer(
      inputs,
      outputs,
      redeemers,
      host_state_nft_policy_id,
      expected_host_state_redeemer,
    )

  expect Some(marker_redeemer) =
    pairs.get_first(redeemers, Mint(operation_policy_id))
  expect marker_redeemer: AuthToken = marker_redeemer
  expect
    validator_utils.require_exact_marker_mint(mint, operation_policy_id, "", 1)

  let continuation_is_valid =
    if requires_continuation {
      let ChannelDatum { .. } =
        validate_output_datum(spent_output, outputs, channel_token)
      True
    } else {
      True
    }

  and {
    continuation_is_valid?,
    marker_redeemer == channel_token,
  }
}

fn extract_output_datum(output: Output) -> ChannelDatum {
  expect datum: ChannelDatum = validator_utils.get_inline_datum(output)
  datum
}

fn validate_output_datum(
  spent_output: Output,
  outputs: List<Output>,
  token: AuthToken,
) {
  validator_utils.find_unique_continuation_output(spent_output, outputs, token)
    |> extract_output_datum()
}
