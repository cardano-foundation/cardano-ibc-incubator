use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{SendPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Operator}
use ibc/utils/validator_utils

validator send_packet(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    _spent_output: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect SendPacket { packet } = channel_redeemer

    trace @"send_packet: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState { channel: cur_channel, next_sequence_send, .. } =
      cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    expect cur_channel.state == chan_state_mod.Open
    trace @"send_packet: channel state is open"

    let is_valid_packet = and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
        packet.sequence == next_sequence_send,
      }
    trace @"send_packet: packet info matched channel state"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"send_packet: reference_inputs contain Connection utxo"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"send_packet: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"send_packet: client status is active"

    let latest_height =
      client_state_mod.get_latest_height(client_datum.state.client_state)
    expect
      height_mod.is_zero(packet.timeout_height) || height_mod.compare(
        latest_height,
        packet.timeout_height,
      ) == Less
    trace @"send_packet: packet timeout_height is not over"

    expect Some(latest_timestamp) =
      client_state_mod.get_timestamp_at_height(
        client_datum.state.client_state,
        client_datum.state.consensus_states,
        latest_height,
      )
    trace @"send_packet: packet timeout_timestamp is not over"

    let commitment = packet_mod.commit_packet(packet)

    trace @"send_packet: channel_datum is updated valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Operator(_) = ibc_module_redeemer
    trace @"send_packet: tx spends module utxo"

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      packet_mod.validate_basic(packet),
      is_valid_packet,
      packet.timeout_timestamp == 0 || latest_timestamp < packet.timeout_timestamp,
      channel_datum_mod.validate_send_packet(
        datum,
        updated_datum,
        packet,
        commitment,
      ),
    }
  }

  else(_) {
    fail
  }
}
