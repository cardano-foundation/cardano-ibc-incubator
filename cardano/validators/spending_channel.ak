use aiken/dict
use aiken/list
use aiken/transaction.{ScriptContext, Transaction}
use aiken/transaction/value.{PolicyId}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client as client_status
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenAck, ChanOpenConfirm, RecvPacket, SpendChannelRedeemer,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{
  OnChanOpenAck, OnChanOpenConfirm, OnRecvPacket,
}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  fn spend_channel(
    datum: ChannelDatum,
    redeemer: SpendChannelRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction {
      outputs,
      reference_inputs,
      validity_range,
      inputs,
      redeemers,
      ..
    } = transaction

    expect auth.contain_auth_token(spent_output, datum.token)
    trace @"spend_channel: input contains auth token"

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)
    trace @"spend_channel: found updated output"

    expect auth.contain_auth_token(updated_output, datum.token)
    trace @"spend_channel: output contains auth token"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"spend_channel: extract tx valid_to"

    expect [connection_id] = datum.state.channel.connection_hops
    trace @"spend_channel: extract connection_id"

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = channel_keys.format_channel_identifier(channel_sequence)
    trace @"spend_channel: extract channel_id"

    when redeemer is {
      ChanOpenAck { counterparty_version, proof_try, proof_height } -> {
        trace @"spend_channel: ChanOpenAck branch"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo\n"

        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          channel_order.string(datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"spend_channel: connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == client_status.Active
        trace @"spend_channel: client status is active\n"

        expect channel_datum_mod.is_channel_open_ack_valid(datum, updated_datum)
        trace @"spend_channel: output datum is updated valid\n"

        expect
          validate_chan_open_ack_proof(
            connection_datum.state,
            client_datum.state,
            channel_id,
            updated_datum,
            counterparty_version,
            proof_try,
            proof_height,
          )
        trace @"spend_channel: channel proof is valid\n"

        expect Some(ibc_module_callback) =
          validator_utils.validate_module_callback(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect ibc_module_callback == OnChanOpenAck { channel_id }
        trace @"spend_channel: ibc module callback is valid\n"

        True
      }
      ChanOpenConfirm { proof_ack, proof_height } -> {
        trace @"spend_channel: ChanOpenConfirm branch"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo\n"

        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          channel_order.string(datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"spend_channel: connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == client_status.Active
        trace @"spend_channel: client status is active\n"

        expect
          channel_datum_mod.is_channel_open_confirm_valid(datum, updated_datum)
        trace @"spend_channel: output datum is updated valid\n"

        expect
          validate_chan_open_confirm_proof(
            connection_datum.state,
            client_datum.state,
            channel_id,
            updated_datum,
            proof_ack,
            proof_height,
          )
        trace @"spend_channel: channel proof is valid\n"

        expect Some(ibc_module_callback) =
          validator_utils.validate_module_callback(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect ibc_module_callback == OnChanOpenConfirm { channel_id }
        trace @"spend_channel: ibc module callback is valid\n"

        True
      }
      RecvPacket { packet, proof_commitment, proof_height } -> {
        trace @"spend_channel: RecvPacket branch"

        let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
        let ChannelDatumState {
          channel: cur_channel,
          packet_receipt: cur_packet_receipt,
          packet_acknowledgement: cur_packet_acknowledgement,
          ..
        } = cur_channel_state

        expect
          packet.destination_port == port_id && packet.destination_channel == channel_id
        expect
          packet.source_port == cur_channel.counterparty.port_id && packet.source_channel == cur_channel.counterparty.channel_id
        trace @"spend_channel: packet ports and channels matched"

        expect cur_channel.state == channel_state.Open
        trace @"spend_channel: channel state is open"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo\n"
        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == client_status.Active
        trace @"spend_channel: client status is active\n"

        expect tx_valid_to * 1_000_000 < packet.timeout_timestamp
        trace @"spend_channel: packet timeout_timestamp is not over\n"

        expect
          validate_recv_packet_proof(
            connection_datum.state,
            client_datum.state,
            proof_height,
            proof_commitment,
            packet,
          )
        trace @"spend_channel: packet proof is valid\n"

        expect Some(ibc_module_callback) =
          validator_utils.validate_module_callback(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect OnRecvPacket { channel_id: module_chan_id, acknowledgement } =
          ibc_module_callback
        expect module_chan_id == channel_id
        trace @"spend_channel: ibc module callback is valid\n"

        expect
          when cur_channel.ordering is {
            channel_order.Unordered -> {
              trace @"spend_channel: channel ordering is  Unordered"

              expect !dict.has_key(cur_packet_receipt, packet.sequence)
              trace @"spend_channel: packet not relayed yet"

              expect !dict.has_key(cur_packet_acknowledgement, packet.sequence)
              trace @"spend_channel: acknowledgement not relayed yet"

              let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)
              expect
                channel_datum_mod.validate_recv_packet(
                  datum,
                  updated_datum,
                  packet,
                  bz_ack,
                )
              trace @"spend_channel: channel datum is updated valid"

              True
            }

            _ -> {
              trace @"spend_channel: channel ordering is not Unordered"
              False
            }
          }

        True
      }
    }
  }
}

fn validate_chan_open_ack_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof_try: ByteArray,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: channel_state.TryOpen,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  verify.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_try,
    proof_height,
    expected_channel,
  )
}

fn validate_chan_open_confirm_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  proof_ack: ByteArray,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: channel_state.TryOpen,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: channel_datum.state.channel.version,
    }

  verify.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_ack,
    proof_height,
    expected_channel,
  )
}

fn validate_recv_packet_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof_commitment: ByteArray,
  packet: Packet,
) -> Bool {
  let commitment = packet_mod.commit_packet(packet)

  expect
    verify.verify_packet_commitment(
      client_datum_state,
      connection_end,
      proof_height,
      proof_commitment,
      packet.source_port,
      packet.source_channel,
      packet.sequence,
      commitment,
    )

  True
}
