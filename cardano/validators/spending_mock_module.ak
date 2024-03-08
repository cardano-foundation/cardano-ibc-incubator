use aiken/dict.{Dict}
use aiken/list
use aiken/transaction.{
  Input, Mint, Output, Redeemer, ScriptContext, ScriptPurpose, Spend,
  Transaction,
}
use aiken/transaction/value.{PolicyId}
use ibc/apps/mock/datum.{MockModuleDatum}
use ibc/apps/mock/datum as mock_module_datum
use ibc/apps/mock/ibc_module as mock_ibc_module
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenAck, ChanOpenConfirm, ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
  RecvPacket, SpendChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleCallback, IBCModuleRedeemer, OnChanOpenAck,
  OnChanOpenConfirm, OnChanOpenInit, OnChanOpenTry, OnRecvPacket, Operator,
}
use ibc/utils/validator_utils

validator(
  handler_token: AuthToken,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
) {
  fn spend_mock_module(
    datum: MockModuleDatum,
    redeemer: IBCModuleRedeemer,
    context: ScriptContext,
  ) -> Bool {
    when redeemer is {
      Callback(cb) ->
        handler_callback(
          cb,
          datum,
          context,
          handler_token,
          port_id,
          channel_minting_policy_id,
        )
      Operator(op) -> handler_operator(op)
    }
  }
}

fn handler_callback(
  cb: IBCModuleCallback,
  datum: MockModuleDatum,
  context: ScriptContext,
  handler_token: AuthToken,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(context)
  let Transaction { outputs, redeemers, inputs, .. } = transaction

  expect Some(updated_module_output) =
    validator_utils.validate_token_remain(spent_output, outputs)
  expect updated_module_datum: MockModuleDatum =
    validator_utils.get_inline_datum(updated_module_output)

  when cb is {
    OnChanOpenInit { channel_id } -> {
      expect Some(output_channel) =
        validate_channel_open_init(
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      expect
        mock_ibc_module.validate_on_chan_open_init(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
        )

      expect
        mock_module_datum.validate_on_chan_open_init(
          datum,
          updated_module_datum,
          channel_id,
        )

      True
    }
    OnChanOpenTry { channel_id } -> {
      expect Some((output_channel, counterparty_version)) =
        validate_channel_open_try(
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      expect
        mock_ibc_module.validate_on_chan_open_try(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
          counterparty_version,
        )

      expect
        mock_module_datum.validate_on_chan_open_try(
          datum,
          updated_module_datum,
          channel_id,
        )

      True
    }
    OnChanOpenAck { channel_id } -> {
      expect Some((output_channel, counterparty_version)) =
        validate_channel_open_ack(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      expect
        mock_ibc_module.validate_on_chan_open_ack(
          port_id,
          channel_id,
          output_channel.counterparty.channel_id,
          counterparty_version,
        )

      expect
        mock_module_datum.validate_on_chan_open_ack(
          datum,
          updated_module_datum,
          channel_id,
        )

      True
    }
    OnChanOpenConfirm { channel_id } -> {
      expect Some(_) =
        validate_channel_open_confirm(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      expect mock_ibc_module.validate_on_chan_open_confirm(port_id, channel_id)

      expect
        mock_module_datum.validate_on_chan_open_confirm(
          datum,
          updated_module_datum,
          channel_id,
        )

      True
    }
    OnRecvPacket { channel_id, acknowledgement } -> {
      expect Some(packet) =
        validate_channel_recv_packet(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      expect mock_ibc_module.validate_on_chan_recv_packet(acknowledgement)

      expect
        mock_module_datum.validate_on_recv_packet(
          datum,
          updated_module_datum,
          channel_id,
          packet,
        )

      True
    }
  }
}

fn handler_operator(_op: Data) -> Bool {
  False
}

fn validate_channel_open_init(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<Channel> {
  // validate mint channel redeemer
  expect Some(mint_channel_redeemer) =
    dict.get(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenInit { handler_token: chan_handler_token } =
    mint_channel_redeemer
  expect chan_handler_token == handler_token

  // validate and extract channel outputs
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some(channel_datum.state.channel)
}

fn validate_channel_open_try(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  // validate mint channel redeemer
  expect Some(mint_channel_redeemer) =
    dict.get(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenTry {
    handler_token: chan_handler_token,
    counterparty_version,
    ..
  } = mint_channel_redeemer
  expect chan_handler_token == handler_token

  // validate and extract channel outputs
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some((channel_datum.state.channel, counterparty_version))
}

fn validate_channel_open_ack(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  // validate spend channel redeemer
  expect Some(spend_channel_redeemer) =
    dict.get(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer
  expect ChanOpenAck { counterparty_version, .. } = spend_channel_redeemer

  // validate and extract channel outputs
  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some((channel_datum.state.channel, counterparty_version))
}

fn validate_channel_open_confirm(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<Channel> {
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  // validate spend channel redeemer
  expect Some(spend_channel_redeemer) =
    dict.get(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer
  expect ChanOpenConfirm { .. } = spend_channel_redeemer

  // validate and extract channel outputs
  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some(channel_datum.state.channel)
}

fn validate_channel_recv_packet(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<Packet> {
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  // validate spend channel redeemer
  expect Some(spend_channel_redeemer) =
    dict.get(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer
  expect RecvPacket { packet, .. } = spend_channel_redeemer

  // validate and extract channel outputs
  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some(packet)
}
