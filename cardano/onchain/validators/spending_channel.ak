use aiken/collection/list
use aiken/collection/pairs
use cardano/address
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, BeginChannelAbandonment, ChanCloseConfirm, ChanCloseInit,
  ChanOpenAck, ChanOpenConfirm, PrunePacketHistory, ReclaimChannel, RecvPacket,
  SendPacket, SpendChannelRedeemer, TimeoutPacket,
}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanReclaim}
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
  prune_packet_history_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  spend(
    optional_datum: Option<ChannelDatum>,
    redeemer: SpendChannelRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      mint,
      validity_range,
      redeemers,
      extra_signatories,
      ..
    } = transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect Some(datum) = optional_datum
    let spent_output = spent_input.output
    expect auth.contain_auth_token(spent_output, datum.token)

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
      PrunePacketHistory { .. } ->
        validate_operation_witness(
          transaction,
          spent_output,
          datum.token,
          host_state_nft_policy_id,
          prune_packet_history_policy_id,
          validator_utils.ExpectHandlePacket,
          True,
        )
      BeginChannelAbandonment { not_before } -> {
        let (host_input, _) =
          validator_utils.require_host_state_redeemer(
            inputs,
            outputs,
            redeemers,
            host_state_nft_policy_id,
            validator_utils.ExpectBeginChannelAbandonment,
          )
        let host_datum = validator_utils.get_host_state_datum(host_input)
        let valid_from = validator_utils.get_tx_valid_from(validity_range)
        let updated_datum =
          validate_output_datum(spent_output, outputs, datum.token)

        and {
          list.has(extra_signatories, host_datum.deployer),
          channel_datum.validate_begin_abandonment(
            datum,
            updated_datum,
            valid_from,
            not_before,
          ),
        }
      }
      ReclaimChannel { reclaim_to } -> {
        let (host_input, _) =
          validator_utils.require_host_state_redeemer(
            inputs,
            outputs,
            redeemers,
            host_state_nft_policy_id,
            validator_utils.ExpectReclaimChannel { reclaim_to },
          )
        let valid_from = validator_utils.get_tx_valid_from(validity_range)

        and {
          channel_datum.is_reclaimable(datum, valid_from),
          auth.burn_auth_token(mint, datum.token),
          validator_utils.no_output_contains_auth_token(outputs, datum.token),
          validator_utils.pays_reclamation_bounty(
            spent_output,
            outputs,
            reclaim_to,
          ),
          validate_reclaim_callback(inputs, redeemers, host_input, datum),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_reclaim_callback(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_input: Input,
  datum: ChannelDatum,
) -> Bool {
  let host_datum = validator_utils.get_host_state_datum(host_input)
  expect Some(registration) =
    pairs.get_first(host_datum.state.bound_port, datum.port_id)
  expect [module_input] =
    list.filter(
      inputs,
      fn(input) {
        auth.contain_auth_token(input.output, registration.port_token)
      },
    )
  expect address.Script(module_script_hash) =
    module_input.output.address.payment_credential
  expect module_script_hash == registration.module_script_hash
  expect
    auth.contains_only_auth_tokens(
      module_input.output,
      [registration.port_token, registration.module_token],
    )
  expect Some(module_spend_redeemer) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))
  expect Callback(OnChanReclaim { channel_id, .. }) = module_spend_redeemer

  channel_id == (
    datum.token.name
      |> auth.extract_token_sequence()
      |> channel_keys.format_channel_identifier()
  )
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
