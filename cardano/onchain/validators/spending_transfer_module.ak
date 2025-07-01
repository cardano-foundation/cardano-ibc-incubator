use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{from_verification_key}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction,
}
use ibc/apps/transfer/ibc_module as transfer_ibc_module
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/transfer_module_redeemer.{OtherTransferOp, Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelDatumState, validate_recv_packet,
}
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, ChanOpenAck, ChanOpenConfirm, ChanOpenInit, ChanOpenTry,
  MintChannelRedeemer, RecvPacket, SendPacket, SpendChannelRedeemer,
  TimeoutPacket,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/acknowledgement_response.{AcknowledgementError}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleCallback, IBCModuleOperator, IBCModuleRedeemer,
  OnAcknowledgementPacket, OnChanCloseConfirm, OnChanCloseInit, OnChanOpenAck,
  OnChanOpenConfirm, OnChanOpenInit, OnChanOpenTry, OnRecvPacket,
  OnTimeoutPacket, Operator, TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator spend_transfer_module(
  handler_token: AuthToken,
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    redeemer: IBCModuleRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, .. } = transaction
    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    let updated_output =
      validator_utils.validate_token_remain(
        spent_output,
        transaction.outputs,
        [port_token, module_token],
      )
    trace @"spend_transfer_module: token is remained"

    expect InlineDatum(void_datum) = updated_output.datum
    expect Void = void_datum

    when redeemer is {
      Callback(cb) ->
        handler_callback(
          cb,
          handler_token,
          spent_output_ref,
          transaction,
          updated_output,
          port_id,
          channel_minting_policy_id,
          voucher_minting_policy_id,
        )
      Operator(op) ->
        handler_operator(
          op,
          handler_token,
          spent_output_ref,
          transaction,
          updated_output,
          channel_minting_policy_id,
          voucher_minting_policy_id,
        )
    }
  }

  else(_) {
    fail
  }
}

// Verifies the expected amount is added/subtracted from the input,
// preventing dust attack from happening
fn validate_output_amount(
  locked_input: Input,
  output: Output,
  additional_value: Value,
) -> Bool {
  trace @"locked_input.output.values": locked_input.output.value
  let lovelace_input = assets.lovelace_of(locked_input.output.value)
  trace @"lovelace_input": lovelace_input

  trace @"additional_value": additional_value

  trace @"output.value": output.value
  let lovelace_output = assets.lovelace_of(output.value)
  trace @"lovelace_output": lovelace_output

  let expected_output =
    locked_input.output.value
      |> assets.merge(additional_value)
  trace @"expected_output": expected_output
  and {
    (lovelace_output - lovelace_input >= 0)?,
    (assets.without_lovelace(output.value) == assets.without_lovelace(
      expected_output,
    ))?,
  }
}

fn handler_callback(
  cb: IBCModuleCallback,
  handler_token: AuthToken,
  spent_output_ref: OutputReference,
  transaction: Transaction,
  updated_output: Output,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  let Transaction { outputs, redeemers, inputs, .. } = transaction

  expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)

  when cb is {
    OnChanOpenInit { channel_id } -> {
      let output_channel =
        validate_channel_open_init(
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )
      and {
        validate_output_amount(spent_input, updated_output, assets.zero)?,
        transfer_ibc_module.validate_on_chan_open_init(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
        )?,
      }
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
      and {
        validate_output_amount(spent_input, updated_output, assets.zero)?,
        transfer_ibc_module.validate_on_chan_open_try(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
          counterparty_version,
        )?,
      }
    }

    OnChanOpenAck { channel_id } -> {
      expect Some((output_channel, counterparty_version)) =
        validate_chan_open_ack(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )

      and {
        validate_output_amount(spent_input, updated_output, assets.zero)?,
        transfer_ibc_module.validate_on_chan_open_ack(
          port_id,
          channel_id,
          output_channel.counterparty.channel_id,
          counterparty_version,
        )?,
      }
    }

    OnChanOpenConfirm { channel_id } -> {
      expect Some(_) =
        validate_chan_open_confirm(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          outputs,
          port_id,
          channel_id,
        )
      and {
        validate_output_amount(spent_input, updated_output, assets.zero)?,
        transfer_ibc_module.validate_on_chan_open_confirm(port_id, channel_id)?,
      }
    }

    OnChanCloseInit { .. } -> False
    OnChanCloseConfirm { .. } -> False
    OnRecvPacket { channel_id, acknowledgement, data } -> {
      trace @"spend_transfer_module: Callback.OnRecvPacket branch"

      expect transfer_ibc_module.validate_on_chan_recv_packet(acknowledgement)
      trace @"spend_transfer_module: acknowledgement is valid"

      expect TransferModuleData(data) = data
      expect fungible_token_packet_data.validate_basic(data)
      trace @"spend_transfer_module: redeemer data is valid"

      expect Some(channel_redeemer) =
        extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          channel_id,
        )
      expect RecvPacket { packet, .. } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      if transfer_coin.receiver_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ) {
        let voucher_prefix_len =
          transfer_coin.get_denom_prefix(
            packet.source_port,
            packet.source_channel,
          )
            |> bytearray.length()
        let unprefixed_denom =
          bytearray.length(data.denom) - 1
            |> bytearray.slice(data.denom, voucher_prefix_len, _)

        expect Some(escrowed_token_unit) =
          string_utils.hex_string_to_bytes(unprefixed_denom)
        trace @"spend_transfer_module: demon convert to token unit valid"

        let (escrowed_token_policy_id, escrowed_token_name) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        let expected_escrow_value_difference =
          assets.from_asset(
            escrowed_token_policy_id,
            escrowed_token_name,
            transfer_amount,
          )
            |> assets.negate()

        let valid_transfer_amount =
          validate_output_amount(
            spent_input,
            updated_output,
            expected_escrow_value_difference,
          )

        expect Some(receiver_public_key_hash) =
          string_utils.hex_string_to_bytes(data.receiver)
        let receiver_address = from_verification_key(receiver_public_key_hash)

        trace @"spend_transfer_module: start channel logic for transfer module"
        expect channel_keys.is_valid_channel_id(channel_id)

        let channel_sequence =
          channel_keys.parse_channel_id_sequence(channel_id)

        let channel_token_name =
          auth.generate_token_name(
            handler_token,
            channel_keys.channel_prefix,
            channel_sequence,
          )

        let channel_token =
          AuthToken {
            policy_id: channel_minting_policy_id,
            name: channel_token_name,
          }

        trace @"spend_transfer_module: locating channel inputs and outputs"
        expect Some(channel_input) =
          list.find(
            inputs,
            fn(input) { input.output |> auth.contain_auth_token(channel_token) },
          )

        expect Some(channel_output) =
          list.find(
            outputs,
            fn(output) { auth.contain_auth_token(output, channel_token) },
          )

        expect input_channel_datum: ChannelDatum =
          validator_utils.get_inline_datum(channel_input.output)
        expect updated_channel_datum: ChannelDatum =
          validator_utils.get_inline_datum(channel_output)

        trace @"spend_transfer_module: extracted datums from channel inputs and outputs"

        let channel_id_from_sequence =
          channel_keys.format_channel_identifier(channel_sequence)

        let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)
        let commit_ack = acknowledgement_mod.commit_acknowledgement(bz_ack)
        let valid_packet =
          validate_recv_packet(
            input_channel_datum,
            updated_channel_datum,
            packet,
            commit_ack,
          )

        expect Some(payout_output) =
          list.find(
            transaction.outputs,
            fn(output) { output.address == receiver_address },
          )

        let derived_channel_sequence =
          auth.extract_token_sequence(updated_channel_datum.token.name)

        and {
          valid_packet?,
          valid_transfer_amount?,
          (channel_id_from_sequence == channel_id)?,
          (derived_channel_sequence == channel_sequence)?,
          (quantity_of(
            payout_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          ) >= transfer_amount)?,
        }
      } else {
        // TODO: (reminder) where is the voucher minted?
        expect Some(mint_voucher_redeemer) =
          pairs.get_first(redeemers, Mint(voucher_minting_policy_id))
        expect mint_voucher_redeemer: MintVoucherRedeemer =
          mint_voucher_redeemer
        expect MintVoucher {
          packet_source_port,
          packet_source_channel,
          packet_dest_port,
          packet_dest_channel,
        } = mint_voucher_redeemer
        trace @"mint_voucher: tx mint voucher token"

        and {
          validate_output_amount(spent_input, updated_output, assets.zero)?,
          (packet_source_port == packet.source_port)?,
          (packet_source_channel == packet.source_channel)?,
          (packet_dest_port == packet.destination_port)?,
          (packet_dest_channel == packet.destination_channel)?,
        }
      }
    }
    OnTimeoutPacket { channel_id, data } -> {
      trace @"spend_transfer_module: Callback.OnTimeoutPacket branch"

      expect Some(channel_redeemer) =
        extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          channel_id,
        )
      expect TimeoutPacket { packet, .. } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect TransferModuleData(data) = data
      let valid_refund_packet =
        validate_refund_packet_token(
          voucher_minting_policy_id,
          inputs,
          outputs,
          redeemers,
          spent_input,
          updated_output,
          data,
          packet,
        )
      and {
        valid_refund_packet?,
        (fungible_token_packet_data.get_bytes(data) == packet.data)?,
      }
    }
    OnAcknowledgementPacket { channel_id, acknowledgement, data } -> {
      trace @"spend_transfer_module: Callback.OnAcknowledgementPacket branch"

      expect Some(channel_redeemer) =
        extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          channel_id,
        )
      expect AcknowledgePacket { packet, acknowledgement: channel_ack, .. } =
        channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect TransferModuleData(tf_data) = data
      when acknowledgement.response is {
        AcknowledgementError { .. } -> and {
            fungible_token_packet_data.get_bytes(tf_data) == packet.data,
            acknowledgement_mod.marshal_json(acknowledgement) == channel_ack,
            validate_refund_packet_token(
              voucher_minting_policy_id,
              inputs,
              outputs,
              redeemers,
              spent_input,
              updated_output,
              tf_data,
              packet,
            ),
          }
        _ -> and {
            validate_output_amount(spent_input, updated_output, assets.zero)?,
            (fungible_token_packet_data.get_bytes(tf_data) == packet.data)?,
            (acknowledgement_mod.marshal_json(acknowledgement) == channel_ack)?,
          }
      }
    }
  }
}

fn handler_operator(
  op: IBCModuleOperator,
  handler_token: AuthToken,
  spent_output_ref: OutputReference,
  transaction: Transaction,
  updated_output: Output,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect TransferModuleOperator(op) = op
  let Transaction { redeemers, inputs, .. } = transaction

  expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)

  when op is {
    Transfer { channel_id, data } -> {
      trace @"spend_transfer_module: Operator.Transfer branch"

      expect fungible_token_packet_data.validate_basic(data)
      trace @"spend_transfer_module: redeemer data is valid"

      expect Some(channel_redeemer) =
        extract_channel_redeemer(
          inputs,
          redeemers,
          channel_minting_policy_id,
          handler_token,
          channel_id,
        )
      expect SendPacket { packet } = channel_redeemer
      trace @"spend_transfer_module: channel redeemer is valid"

      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      if transfer_coin.sender_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ) {
        expect
          pairs.get_first(redeemers, Mint(voucher_minting_policy_id)) == None
        trace @"spend_transfer_module: tx not mint voucher token"

        expect Some(escrowed_token_unit) =
          string_utils.hex_string_to_bytes(data.denom)
        trace @"spend_transfer_module: demon convert to token unit valid"

        let (escrowed_token_policy_id, escrowed_token_name) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        let expected_escrow_value_difference =
          assets.from_asset(
            escrowed_token_policy_id,
            escrowed_token_name,
            transfer_amount,
          )

        let valid_transfer_amount =
          validate_output_amount(
            spent_input,
            updated_output,
            expected_escrow_value_difference,
          )

        valid_transfer_amount
      } else {
        expect Some(mint_voucher_redeemer) =
          pairs.get_first(redeemers, Mint(voucher_minting_policy_id))
        expect mint_voucher_redeemer: MintVoucherRedeemer =
          mint_voucher_redeemer
        expect BurnVoucher { packet_source_port, packet_source_channel } =
          mint_voucher_redeemer
        and {
          (packet_source_port == packet.source_port)?,
          (packet_source_channel == packet.source_channel)?,
        }
      }
    }

    OtherTransferOp -> False
  }
}

fn validate_channel_open_init(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Channel {
  // validate mint channel redeemer
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenInit { handler_token: chan_handler_token } =
    mint_channel_redeemer
  expect chan_handler_token == handler_token

  // validate and extract channel outputs
  expect channel_keys.is_valid_channel_id(channel_id)

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

  channel_datum.state.channel
}

fn validate_channel_open_try(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  // validate mint channel redeemer
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenTry {
    handler_token: chan_handler_token,
    counterparty_version,
    ..
  } = mint_channel_redeemer
  expect chan_handler_token == handler_token

  // validate and extract channel outputs
  expect channel_keys.is_valid_channel_id(channel_id)

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

fn validate_chan_open_ack(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  expect channel_keys.is_valid_channel_id(channel_id)

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
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
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

fn validate_chan_open_confirm(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<Channel> {
  expect channel_keys.is_valid_channel_id(channel_id)

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
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
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

fn extract_channel_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  handler_token: AuthToken,
  channel_id: ByteArray,
) -> Option<SpendChannelRedeemer> {
  expect channel_keys.is_valid_channel_id(channel_id)

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
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer

  Some(spend_channel_redeemer)
}

fn validate_refund_packet_token(
  voucher_minting_policy_id: PolicyId,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  spent_input: Input,
  updated_output: Output,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  if transfer_coin.sender_chain_is_source(
    packet.source_port,
    packet.source_channel,
    data.denom,
  ) {
    expect Some(escrowed_token_unit) =
      string_utils.hex_string_to_bytes(data.denom)
    trace @"spend_transfer_module: demon convert to token unit valid"

    let (escrowed_token_policy_id, escrowed_token_name) =
      validator_utils.extract_token_unit(escrowed_token_unit)
    trace @"spend_transfer_module: extract escrowed token valid"

    expect Some(transfer_amount) = int.from_utf8(data.amount)
    trace @"spend_transfer_module: transfer amount is valid"

    trace @"escrowed_token_policy_id": escrowed_token_policy_id
    trace @"escrowed_token_name": escrowed_token_name

    let expected_escrow_value_difference =
      assets.from_asset(
        escrowed_token_policy_id,
        escrowed_token_name,
        transfer_amount,
      )
        |> assets.negate()
    let correct_transfer_amount =
      validate_output_amount(
        spent_input,
        updated_output,
        expected_escrow_value_difference,
      )

    // let correct_transfer_amount =
    //   prev_escrowed_token - post_escrowed_token == transfer_amount
    trace @"spend_transfer_module (validate_refund_packet_token): unescrowed amount is valid"

    expect Some(sender_public_key_hash) =
      string_utils.hex_string_to_bytes(data.sender)
    let receiver_address = from_verification_key(sender_public_key_hash)

    let prev_receiver_token =
      list.reduce(
        inputs,
        0,
        fn(acc, input) {
          let output = input.output
          if output.address == receiver_address {
            let output_token =
              quantity_of(
                output.value,
                escrowed_token_policy_id,
                escrowed_token_name,
              )
            acc + output_token
          } else {
            acc
          }
        },
      )
    let post_receiver_token =
      list.reduce(
        outputs,
        0,
        fn(acc, output) {
          if output.address == receiver_address {
            let output_token =
              quantity_of(
                output.value,
                escrowed_token_policy_id,
                escrowed_token_name,
              )
            acc + output_token
          } else {
            acc
          }
        },
      )
    and {
      correct_transfer_amount?,
      post_receiver_token - prev_receiver_token == transfer_amount,
    }
  } else {
    expect Some(mint_voucher_redeemer) =
      pairs.get_first(redeemers, Mint(voucher_minting_policy_id))
    expect mint_voucher_redeemer: MintVoucherRedeemer = mint_voucher_redeemer
    expect RefundVoucher { packet_source_port, packet_source_channel } =
      mint_voucher_redeemer
    trace @"mint_voucher (validate_refund_packet_token): tx mint voucher token"

    and {
      validate_output_amount(spent_input, updated_output, assets.zero)?,
      (packet_source_port == packet.source_port)?,
      (packet_source_channel == packet.source_channel)?,
    }
  }
}
