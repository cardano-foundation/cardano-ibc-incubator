use aiken/dict
use aiken/int
use aiken/list
use aiken/transaction.{Output, ScriptContext, Transaction}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{AcknowledgePacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket,
}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  fn acknowledge_packet(
    channel_token: AuthToken,
    context: ScriptContext,
  ) -> Bool {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = context.transaction

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect auth.contain_auth_token(spent_output, datum.token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    expect auth.contain_auth_token(updated_output, datum.token)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect [connection_id] = datum.state.channel.connection_hops

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect AcknowledgePacket {
      packet,
      acknowledgement,
      proof_acked,
      proof_height,
    } = channel_redeemer

    trace @"acknowledge_packet: tx context extracted"

    trace @"acknowledge_packet: AcknowledgePacket branch"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_commitment: cur_packet_commitment,
      next_sequence_ack,
      ..
    } = cur_channel_state

    expect cur_channel.state == chan_state_mod.Open
    trace @"acknowledge_packet: channel state is open"

    expect and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
      }
    trace @"acknowledge_packet: packet info matched channel state"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"acknowledge_packet: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"acknowledge_packet: connection state is open"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"acknowledge_packet: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        dict.from_list(client_datum.state.consensus_states, height_mod.compare),
      ) == client_status_mod.Active
    trace @"acknowledge_packet: client status is active"

    expect Some(commitment) =
      dict.from_list(cur_packet_commitment, int.compare)
        |> dict.get(packet.sequence)
    trace @"acknowledge_packet: packet commitment existed"

    let packet_commitment = packet_mod.commit_packet(packet)
    expect commitment == packet_commitment
    trace @"acknowledge_packet: ack packet match commit packet"

    expect
      verify_mod.verify_packet_acknowledgement(
        client_datum.state,
        connection_datum.state,
        proof_height,
        proof_acked,
        packet.destination_port,
        packet.destination_channel,
        packet.sequence,
        acknowledgement,
      )
    trace @"acknowledge_packet: packet proof is valid"

    expect cur_channel.ordering != chan_order_mod.Ordered || {
        expect packet.sequence == next_sequence_ack
        trace @"acknowledge_packet: packet sequence matched next_sequence_ack"
        True
      }

    expect
      channel_datum_mod.validate_acknowledge_packet(
        datum,
        updated_datum,
        packet,
      )
    trace @"acknowledge_packet: channel datum is updated valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect OnAcknowledgementPacket { channel_id: module_chan_id, .. } =
      ibc_module_callback
    expect module_chan_id == channel_id
    trace @"acknowledge_packet: ibc module callback is valid\n"

    True
  }
}
