use aiken/dict
use aiken/int
use aiken/list
use aiken/transaction.{Mint, Output, ScriptContext, Transaction}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_003_connection_semantics/verify_proof_redeemer.{
  VerifyPacketReceiptAbsence, VerifyProofRedeemer,
}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{TimeoutPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnTimeoutPacket}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  fn timeout_packet(channel_token: AuthToken, context: ScriptContext) -> Bool {
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

    expect TimeoutPacket {
      packet,
      proof_unreceived,
      proof_height,
      next_sequence_recv,
    } = channel_redeemer

    trace @"timeout_packet: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_commitment: cur_packet_commitment,
      ..
    } = cur_channel_state

    expect cur_channel.state == chan_state_mod.Open
    trace @"timeout_packet: channel state is open"

    expect and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
      }
    trace @"timeout_packet: packet info matched channel state"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"timeout_packet: reference_inputs contain Connection utxo"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"timeout_packet: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        dict.from_list(client_datum.state.consensus_states, height_mod.compare),
      ) == client_status_mod.Active
    trace @"timeout_packet: client status is active"

    expect Some(proof_timestamp) =
      client_state_mod.get_timestamp_at_height(
        client_datum.state.client_state,
        dict.from_list(client_datum.state.consensus_states, height_mod.compare),
        proof_height,
      )
    expect or {
        !height_mod.is_zero(packet.timeout_height) && !(height_mod.compare(
          proof_height,
          packet.timeout_height,
        ) == Less),
        packet.timeout_timestamp != 0 && proof_timestamp >= packet.timeout_timestamp,
      }
    trace @"timeout_packet: packet is timeout"

    expect Some(commitment) =
      dict.from_list(cur_packet_commitment, int.compare)
        |> dict.get(packet.sequence)
    trace @"timeout_packet: packet commitment existed"

    let packet_commitment = packet_mod.commit_packet(packet)
    expect commitment == packet_commitment
    trace @"timeout_packet: timeout packet match commit packet"

    expect
      when cur_channel.ordering is {
        chan_order_mod.Unordered -> {
          trace @"timeout_packet: channel ordering is  Unordered"

          expect Some(verify_proof_redeemer) =
            dict.get(redeemers, Mint(verify_proof_policy_id))
          expect verify_proof_redeemer: VerifyProofRedeemer =
            verify_proof_redeemer
          expect
            verify_proof_redeemer == VerifyPacketReceiptAbsence {
              client_datum_state: client_datum.state,
              connection: connection_datum.state,
              proof_height,
              proof: proof_unreceived,
              port_id: packet.destination_port,
              channel_id: packet.destination_channel,
              sequence: packet.sequence,
            }
          trace @"timeout_packet: packet proof is valid"

          True
        }
        chan_order_mod.Ordered -> {
          trace @"timeout_packet: channel ordering is not Unordered"

          expect next_sequence_recv <= packet.sequence
          trace @"timeout_packet: packet not received yet"

          expect
            verify_mod.verify_next_sequence_recv(
              client_datum.state,
              connection_datum.state,
              proof_height,
              proof_unreceived,
              packet.destination_port,
              packet.destination_channel,
              next_sequence_recv,
            )
          trace @"timeout_packet: packet proof is valid"

          True
        }
        _ -> False
      }

    expect
      channel_datum_mod.validate_timeout_packet(datum, updated_datum, packet)
    trace @"timeout_packet: channel datum is updated valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect OnTimeoutPacket { channel_id: module_chan_id, .. } =
      ibc_module_callback
    expect module_chan_id == channel_id
    trace @"timeout_packet: ibc module callback is valid"

    True
  }
}
