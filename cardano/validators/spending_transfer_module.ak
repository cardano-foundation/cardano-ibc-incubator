use aiken/bytearray
use aiken/dict.{Dict}
use aiken/int
use aiken/list
use aiken/string
use aiken/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptContext, ScriptPurpose, Spend, Transaction, TransactionId,
}
use aiken/transaction/credential
use aiken/transaction/value.{PolicyId}
use ibc/apps/transfer/ibc_module as transfer_ibc_module
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/transfer_module_datum.{TransferModuleDatum}
use ibc/apps/transfer/transfer_module_redeemer.{OtherTransferOp, Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/types/keys as transfer_module_keys
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
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
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleCallback, IBCModuleOperator, IBCModuleRedeemer,
  OnAcknowledgementPacket, OnChanCloseInit, OnChanOpenAck, OnChanOpenConfirm,
  OnChanOpenInit, OnChanOpenTry, OnRecvPacket, OnTimeoutPacket, Operator,
  TransferModuleData, TransferModuleOperator,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator(
  handler_token: AuthToken,
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) {
  fn spend_transfer_module(
    _datum: TransferModuleDatum,
    redeemer: IBCModuleRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)

    expect Some(updated_output) =
      validator_utils.validate_token_remain(
        spent_output,
        transaction.outputs,
        [port_token, module_token],
      )
    trace @"spend_transfer_module: token is remained"

    when redeemer is {
      Callback(cb) ->
        handler_callback(
          cb,
          handler_token,
          context,
          updated_output,
          port_id,
          channel_minting_policy_id,
          voucher_minting_policy_id,
        )
      Operator(op) ->
        handler_operator(
          op,
          handler_token,
          context,
          updated_output,
          channel_minting_policy_id,
          voucher_minting_policy_id,
        )
    }
  }
}

fn handler_callback(
  cb: IBCModuleCallback,
  handler_token: AuthToken,
  context: ScriptContext,
  updated_output: Output,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(context)
  let Transaction { outputs, redeemers, inputs, .. } = transaction

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
        transfer_ibc_module.validate_on_chan_open_init(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
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
        transfer_ibc_module.validate_on_chan_open_try(
          output_channel.ordering,
          output_channel.connection_hops,
          port_id,
          channel_id,
          output_channel.counterparty,
          output_channel.version,
          counterparty_version,
        )

      True
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

      expect
        transfer_ibc_module.validate_on_chan_open_ack(
          port_id,
          channel_id,
          output_channel.counterparty.channel_id,
          counterparty_version,
        )

      True
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

      expect
        transfer_ibc_module.validate_on_chan_open_confirm(port_id, channel_id)

      True
    }
    OnChanCloseInit { .. } -> False
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

      if
      transfer_coin.receiver_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ){
      
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

        expect Some((escrowed_token_policy_id, escrowed_token_name)) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        let prev_escrowed_token =
          value.quantity_of(
            spent_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          )
        let post_escrowed_token =
          value.quantity_of(
            updated_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          )
        expect prev_escrowed_token - post_escrowed_token == transfer_amount
        trace @"spend_transfer_module: unescrowed amount is valid"

        expect Some(receiver_public_key_hash) =
          string_utils.hex_string_to_bytes(data.receiver)
        let receiver_address =
          credential.from_verification_key(receiver_public_key_hash)

        let prev_receiver_token =
          list.reduce(
            inputs,
            0,
            fn(acc, input) {
              let output = input.output
              if output.address == receiver_address {
                let output_token =
                  value.quantity_of(
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
                  value.quantity_of(
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
        expect post_receiver_token - prev_receiver_token == transfer_amount
        trace @"spend_transfer_module: receiver's token is update valid"

        True
      } else {
        expect Some(mint_voucher_redeemer) =
          dict.get(redeemers, Mint(voucher_minting_policy_id))
        expect mint_voucher_redeemer: MintVoucherRedeemer =
          mint_voucher_redeemer
        expect MintVoucher {
          packet_source_port,
          packet_source_channel,
          packet_dest_port,
          packet_dest_channel,
        } = mint_voucher_redeemer
        trace @"mint_voucher: tx mint voucher token"

        expect and {
            packet_source_port == packet.source_port,
            packet_source_channel == packet.source_channel,
            packet_dest_port == packet.destination_port,
            packet_dest_channel == packet.destination_channel,
          }
        trace @"mint_voucher: mint voucher redeemer is valid"

        True
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
      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      validate_refund_packet_token(
        voucher_minting_policy_id,
        inputs,
        outputs,
        redeemers,
        spent_output,
        updated_output,
        data,
        packet,
      )
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

      expect TransferModuleData(data) = data
      expect fungible_token_packet_data.get_bytes(data) == packet.data
      trace @"spend_transfer_module: FungibleTokenPacketData is unmarshal valid"

      expect acknowledgement_mod.marshal_json(acknowledgement) == channel_ack
      trace @"spend_transfer_module: Acknowledgement is unmarshal valid"

      when acknowledgement.response is {
        AcknowledgementError { .. } ->
          validate_refund_packet_token(
            voucher_minting_policy_id,
            inputs,
            outputs,
            redeemers,
            spent_output,
            updated_output,
            data,
            packet,
          )
        _ -> True
      }
    }
  }
}

fn handler_operator(
  op: IBCModuleOperator,
  handler_token: AuthToken,
  context: ScriptContext,
  updated_output: Output,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect TransferModuleOperator(op) = op
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(context)
  let Transaction { redeemers, inputs, .. } = transaction

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

      if
      transfer_coin.sender_chain_is_source(
        packet.source_port,
        packet.source_channel,
        data.denom,
      ){
      
        expect dict.get(redeemers, Mint(voucher_minting_policy_id)) == None
        trace @"spend_transfer_module: tx not mint voucher token"

        expect Some(escrowed_token_unit) =
          string_utils.hex_string_to_bytes(data.denom)
        trace @"spend_transfer_module: demon convert to token unit valid"

        expect Some((escrowed_token_policy_id, escrowed_token_name)) =
          validator_utils.extract_token_unit(escrowed_token_unit)
        trace @"spend_transfer_module: extract escrowed token valid"

        let prev_escrowed_token =
          value.quantity_of(
            spent_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          )
        let post_escrowed_token =
          value.quantity_of(
            updated_output.value,
            escrowed_token_policy_id,
            escrowed_token_name,
          )
        expect Some(transfer_amount) = int.from_utf8(data.amount)
        trace @"spend_transfer_module: transfer amount is valid"

        expect post_escrowed_token - prev_escrowed_token == transfer_amount
        trace @"spend_transfer_module: escrowed amount is valid"

        True
      } else {
        expect Some(mint_voucher_redeemer) =
          dict.get(redeemers, Mint(voucher_minting_policy_id))
        expect mint_voucher_redeemer: MintVoucherRedeemer =
          mint_voucher_redeemer
        expect BurnVoucher { packet_source_port, packet_source_channel } =
          mint_voucher_redeemer
        expect
          packet_source_port == packet.source_port && packet_source_channel == packet.source_channel

        True
      }
    }

    OtherTransferOp -> False
  }
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
  redeemers: Dict<ScriptPurpose, Redeemer>,
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

fn validate_chan_open_confirm(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
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

fn extract_channel_redeemer(
  inputs: List<Input>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
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
    dict.get(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer

  Some(spend_channel_redeemer)
}

fn validate_refund_packet_token(
  voucher_minting_policy_id: PolicyId,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Dict<ScriptPurpose, Redeemer>,
  spent_output: Output,
  updated_output: Output,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  if
  transfer_coin.sender_chain_is_source(
    packet.source_port,
    packet.source_channel,
    data.denom,
  ){
  
    expect Some(escrowed_token_unit) =
      string_utils.hex_string_to_bytes(data.denom)
    trace @"spend_transfer_module: demon convert to token unit valid"

    expect Some((escrowed_token_policy_id, escrowed_token_name)) =
      validator_utils.extract_token_unit(escrowed_token_unit)
    trace @"spend_transfer_module: extract escrowed token valid"

    expect Some(transfer_amount) = int.from_utf8(data.amount)
    trace @"spend_transfer_module: transfer amount is valid"

    let prev_escrowed_token =
      value.quantity_of(
        spent_output.value,
        escrowed_token_policy_id,
        escrowed_token_name,
      )
    let post_escrowed_token =
      value.quantity_of(
        updated_output.value,
        escrowed_token_policy_id,
        escrowed_token_name,
      )
    expect prev_escrowed_token - post_escrowed_token == transfer_amount
    trace @"spend_transfer_module: unescrowed amount is valid"

    expect Some(sender_public_key_hash) =
      string_utils.hex_string_to_bytes(data.sender)
    let receiver_address =
      credential.from_verification_key(sender_public_key_hash)

    let prev_receiver_token =
      list.reduce(
        inputs,
        0,
        fn(acc, input) {
          let output = input.output
          if output.address == receiver_address {
            let output_token =
              value.quantity_of(
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
              value.quantity_of(
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
    expect post_receiver_token - prev_receiver_token == transfer_amount
    trace @"mint_voucher: sender's token is update valid"

    True
  } else {
    expect Some(mint_voucher_redeemer) =
      dict.get(redeemers, Mint(voucher_minting_policy_id))
    expect mint_voucher_redeemer: MintVoucherRedeemer = mint_voucher_redeemer
    expect RefundVoucher { packet_source_port, packet_source_channel } =
      mint_voucher_redeemer
    trace @"mint_voucher: tx mint voucher token"

    expect and {
        packet_source_port == packet.source_port,
        packet_source_channel == packet.source_channel,
      }
    trace @"mint_voucher: mint voucher redeemer is valid"

    True
  }
}

//=====================================Test================================================

type MockData {
  handler_token: AuthToken,
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  channel_id: ByteArray,
  module_output: Output,
  module_input: Input,
  channel_output: Output,
  channel_input: Input,
  proof_height: Height,
  proof: MerkleProof,
  cardano_public_key_hash: ByteArray,
  cosmos_address: ByteArray,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      policy_id: "mock handler token policy_id",
      name: "mock handler token name",
    }

  let port_token =
    AuthToken {
      policy_id: "mock port token policy_id",
      name: "mock port token name",
    }

  let module_token =
    AuthToken {
      policy_id: "mock module token policy_id",
      name: "mock module token name",
    }

  let port_id = "port-1"

  let channel_minting_policy_id = "mock channel minting policy id"

  let voucher_minting_policy_id = "mock voucher minting policy id"

  let channel_id = "channel-0"

  let module_output =
    Output {
      address: credential.from_script("mock module script hash"),
      value: value.from_asset(module_token.policy_id, module_token.name, 1)
        |> value.add(port_token.policy_id, port_token.name, 1)
        |> value.add(value.ada_policy_id, value.ada_asset_name, 99999999999),
      datum: InlineDatum(Void),
      reference_script: None,
    }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId("mock module input tx id"),
        output_index: 0,
      },
      output: module_output,
    }

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

  let channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: Channel {
          state: chan_state_mod.Init,
          ordering: chan_order_mod.Unordered,
          counterparty: ChannelCounterparty { port_id: "", channel_id: "" },
          connection_hops: [],
          version: transfer_module_keys.version,
        },
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id,
      token: channel_token,
    }

  let channel_output =
    Output {
      address: credential.from_script("mock channel script hash"),
      value: value.from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(channel_datum),
      reference_script: None,
    }

  let channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId("mock channel input tx id"),
        output_index: 0,
      },
      output: channel_output,
    }

  let proof_height = Height { revision_number: 1, revision_height: 14 }

  let proof = MerkleProof { proofs: [] }

  //525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22
  let cardano_public_key_hash =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let cosmos_address = "mock cosmos address"

  MockData {
    handler_token,
    port_token,
    module_token,
    port_id,
    channel_minting_policy_id,
    voucher_minting_policy_id,
    channel_id,
    module_output,
    module_input,
    channel_output,
    channel_input,
    proof_height,
    proof,
    cardano_public_key_hash,
    cosmos_address,
  }
}

fn build_packet(
  denom: ByteArray,
  amount: Int,
  sender: ByteArray,
  receiver: ByteArray,
  source_port: ByteArray,
  source_channel: ByteArray,
  destination_port: ByteArray,
  destination_channel: ByteArray,
) -> (FungibleTokenPacketData, Packet) {
  let amount = string.from_int(amount) |> string.to_bytearray()

  let ftpd =
    FungibleTokenPacketData { denom, amount, sender, receiver, memo: "" }

  let packet =
    Packet {
      sequence: 1,
      source_port,
      source_channel,
      destination_port,
      destination_channel,
      data: fungible_token_packet_data.get_bytes(ftpd),
      timeout_height: height.zero_height(),
      timeout_timestamp: 1111,
    }

  (ftpd, packet)
}

test on_chan_open_init_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenInit { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenInit { handler_token: mock.handler_token }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.channel_minting_policy_id),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_chan_open_try_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenTry { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenTry {
      handler_token: mock.handler_token,
      counterparty_version: transfer_module_keys.version,
      proof_init: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.channel_minting_policy_id),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_chan_open_ack_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenAck { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenAck {
      counterparty_version: transfer_module_keys.version,
      proof_try: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_chan_open_confirm_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanOpenConfirm { channel_id: mock.channel_id })

  let channel_redeemer: Redeemer =
    ChanOpenConfirm { proof_ack: mock.proof, proof_height: mock.proof_height }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_recv_packet_mint_voucher_succeed() {
  let mock = setup()

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement(#"01")

  let (ftpd, packet) =
    build_packet(
      "atom",
      1234,
      mock.cosmos_address,
      mock.cardano_public_key_hash,
      "port-0",
      "channel-0",
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }

  let mint_voucher_redeemer: Redeemer =
    MintVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
      packet_dest_port: packet.destination_port,
      packet_dest_channel: packet.destination_channel,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.voucher_minting_policy_id),
          mint_voucher_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_recv_packet_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let module_output =
    Output {
      ..mock.module_output,
      value: mock.module_output.value
        |> value.add(value.ada_policy_id, value.ada_asset_name, -transfer_amount),
    }

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let receiver_output =
    Output {
      address: credential.from_verification_key(receiver_public_key_hash),
      value: value.from_asset(
        value.ada_policy_id,
        value.ada_asset_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [module_output, mock.channel_output, receiver_output]

  //==========================arrange redeemers=========================
  let acknowledgement = acknowledgement_mod.new_result_acknowledgement(#"01")

  let source_port = "port-0"
  let source_channel = "channel-0"

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("6c6f76656c616365")

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test transfer_escrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let module_output =
    Output {
      ..mock.module_output,
      value: mock.module_output.value
        |> value.add(value.ada_policy_id, value.ada_asset_name, transfer_amount),
    }

  let outputs =
    [module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )

  let channel_redeemer: Redeemer = SendPacket { packet }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test transfer_burn_voucher_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let module_output =
    Output {
      ..mock.module_output,
      value: mock.module_output.value
        |> value.add(value.ada_policy_id, value.ada_asset_name, -transfer_amount),
    }

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let receiver_output =
    Output {
      address: credential.from_verification_key(receiver_public_key_hash),
      value: value.from_asset(
        value.ada_policy_id,
        value.ada_asset_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [module_output, mock.channel_output, receiver_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let module_redeemer: Redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: mock.channel_id, data: ftpd },
      ),
    )

  let channel_redeemer: Redeemer = SendPacket { packet }

  let mint_voucher_redeemer: Redeemer =
    BurnVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.voucher_minting_policy_id),
          mint_voucher_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_timeout_packet_mint_voucher_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id: mock.channel_id, data: packet_data })

  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }

  let mint_voucher_redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.voucher_minting_policy_id),
          mint_voucher_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_timeout_packet_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let sender = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let module_output =
    Output {
      ..mock.module_output,
      value: mock.module_output.value
        |> value.add(value.ada_policy_id, value.ada_asset_name, -transfer_amount),
    }

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let receiver_output =
    Output {
      address: credential.from_verification_key(sender_public_key_hash),
      value: value.from_asset(
        value.ada_policy_id,
        value.ada_asset_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [module_output, mock.channel_output, receiver_output]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id: mock.channel_id, data: packet_data })

  let channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived: mock.proof,
      proof_height: mock.proof_height,
      next_sequence_recv: 1,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_acknowledgement_packet_result_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let acknowledgement = acknowledgement_mod.new_result_acknowledgement(#"01")

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_acknowledgement_packet_error_mint_voucher_succeed() {
  let mock = setup()

  let receiver = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let outputs =
    [mock.module_output, mock.channel_output]

  //==========================arrange redeemers=========================
  let source_port = mock.port_id
  let source_channel = mock.channel_id

  let denom =
    transfer_coin.get_denom_prefix(source_port, source_channel)
      |> bytearray.concat("atom")

  let (ftpd, packet) =
    build_packet(
      denom,
      1234,
      mock.cosmos_address,
      receiver,
      source_port,
      source_channel,
      "port-0",
      "channel-0",
    )

  let acknowledgement = acknowledgement_mod.new_error_acknowledgement("")

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let mint_voucher_redeemer: Redeemer =
    RefundVoucher {
      packet_source_port: packet.source_port,
      packet_source_channel: packet.source_channel,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.voucher_minting_policy_id),
          mint_voucher_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_acknowledgement_packet_error_unescrow_succeed() {
  let mock = setup()

  let transfer_amount = 1234

  let sender = mock.cardano_public_key_hash

  //==========================arrange inputs=========================
  let inputs =
    [mock.module_input, mock.channel_input]

  //==========================arrange outputs=========================
  let module_output =
    Output {
      ..mock.module_output,
      value: mock.module_output.value
        |> value.add(value.ada_policy_id, value.ada_asset_name, -transfer_amount),
    }

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let receiver_output =
    Output {
      address: credential.from_verification_key(sender_public_key_hash),
      value: value.from_asset(
        value.ada_policy_id,
        value.ada_asset_name,
        transfer_amount,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let outputs =
    [module_output, mock.channel_output, receiver_output]

  //==========================arrange redeemers=========================
  let source_port = "port-0"
  let source_channel = "channel-0"

  // lovelace
  let denom = "6c6f76656c616365"

  let (ftpd, packet) =
    build_packet(
      denom,
      transfer_amount,
      sender,
      mock.cosmos_address,
      source_port,
      source_channel,
      mock.port_id,
      mock.channel_id,
    )

  let acknowledgement = acknowledgement_mod.new_result_acknowledgement(#"01")

  let packet_data = TransferModuleData(ftpd)

  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: mock.channel_id,
        acknowledgement,
        data: packet_data,
      },
    )

  let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)

  let channel_redeemer: Redeemer =
    AcknowledgePacket {
      packet,
      acknowledgement: bz_ack,
      proof_acked: mock.proof,
      proof_height: mock.proof_height,
    }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Spend(mock.channel_input.output_reference),
          channel_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(mock.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    mock.handler_token,
    mock.port_token,
    mock.module_token,
    mock.port_id,
    mock.channel_minting_policy_id,
    mock.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  )
}

test on_chan_close_init_given_any_input_returns_false() {
  let fake_data = setup()

  //==========================arrange inputs=========================
  let inputs =
    [fake_data.module_input]

  //==========================arrange outputs=========================
  let module_output = fake_data.module_input.output

  let outputs =
    [module_output]

  //==========================arrange redeemers=========================
  let module_redeemer: Redeemer =
    Callback(OnChanCloseInit { channel_id: fake_data.channel_id })

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(fake_data.module_input.output_reference),
          module_redeemer,
          validator_utils.compare_purpose,
        )
  //==========================arrange context=========================
  let purpose = Spend(fake_data.module_input.output_reference)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      redeemers: redeemers,
    }

  let context = ScriptContext { purpose, transaction }

  expect module_redeemer: IBCModuleRedeemer = module_redeemer

  spend_transfer_module(
    fake_data.handler_token,
    fake_data.port_token,
    fake_data.module_token,
    fake_data.port_id,
    fake_data.channel_minting_policy_id,
    fake_data.voucher_minting_policy_id,
    Void,
    module_redeemer,
    context,
  ) == False
}
