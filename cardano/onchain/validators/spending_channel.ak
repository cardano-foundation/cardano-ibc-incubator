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
    let Transaction { inputs, redeemers, outputs, .. } = transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect Some(datum) = optional_datum
    let spent_output = spent_input.output
    when redeemer is {
      ChanOpenAck { .. } -> {
        // Channel handshake updates must be committed into the HostState root in the same transaction.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_open_ack_policy_id))

        expect redeemer: AuthToken = redeemer

        expect _ = validate_output_datum(spent_output, outputs, datum.token)

        redeemer == datum.token
      }

      ChanOpenConfirm { .. } -> {
        // Channel handshake updates must be committed into the HostState root in the same transaction.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_open_confirm_policy_id))

        expect redeemer: AuthToken = redeemer

        expect _ = validate_output_datum(spent_output, outputs, datum.token)

        redeemer == datum.token
      }
      ChanCloseInit -> {
        // Channel state changes must be committed into the HostState root in the same transaction.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_close_init_policy_id))

        expect redeemer: AuthToken = redeemer
        and {
          // Closing this channel should only remove this channel token, not monopolize the script address.
          validator_utils.no_output_contains_auth_token(outputs, datum.token),
          redeemer == datum.token,
        }
      }
      ChanCloseConfirm { .. } -> {
        // Channel state changes must be committed into the HostState root in the same transaction.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_close_confirm_policy_id))

        expect redeemer: AuthToken = redeemer

        redeemer == datum.token
      }
      RecvPacket { .. } -> {
        // Packet processing changes channel/packet state, so it must be committed into HostState.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(recv_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output, outputs, datum.token)
        redeemer == datum.token
      }
      SendPacket { .. } -> {
        // Packet processing changes channel/packet state, so it must be committed into HostState.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(send_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output, outputs, datum.token)
        redeemer == datum.token
      }
      TimeoutPacket { .. } -> {
        // Packet processing changes channel/packet state, so it must be committed into HostState.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(timeout_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output, outputs, datum.token)
        redeemer == datum.token
      }
      AcknowledgePacket { .. } -> {
        // Packet processing changes channel/packet state, so it must be committed into HostState.
        expect _ =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )

        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(acknowledge_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output, outputs, datum.token)
        redeemer == datum.token
      }
    }
  }

  else(_) {
    fail
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
