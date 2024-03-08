use aiken/dict.{Dict}
use aiken/int
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state as channel_state

pub type ChannelDatum {
  state: ChannelDatumState,
  port_id: ByteArray,
  token: AuthToken,
}

pub type ChannelDatumState {
  channel: Channel,
  next_sequence_send: Int,
  next_sequence_recv: Int,
  next_sequence_ack: Int,
  packet_commitment: Dict<Int, ByteArray>,
  packet_receipt: Dict<Int, ByteArray>,
  packet_acknowledgement: Dict<Int, ByteArray>,
}

pub fn is_chan_open_init_valid(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, token, .. } = datum

  let ChannelDatumState {
    channel,
    next_sequence_send,
    next_sequence_recv,
    next_sequence_ack,
    packet_commitment,
    packet_receipt,
    packet_acknowledgement,
  } = state

  expect channel.validate_basic(channel)

  let Channel { state: chan_state, counterparty, .. } = channel

  expect token == auth_token

  expect chan_state == channel_state.Init

  expect counterparty.channel_id == ""

  expect and {
      next_sequence_send == 1,
      next_sequence_recv == 1,
      next_sequence_ack == 1,
    }

  expect and {
      dict.is_empty(packet_commitment),
      dict.is_empty(packet_receipt),
      dict.is_empty(packet_acknowledgement),
    }

  True
}

pub fn is_chan_open_try_valid(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, token, .. } = datum

  let ChannelDatumState {
    channel,
    next_sequence_send,
    next_sequence_recv,
    next_sequence_ack,
    packet_commitment,
    packet_receipt,
    packet_acknowledgement,
  } = state

  expect channel.validate_basic(channel)

  let Channel { state: chan_state, counterparty, .. } = channel

  expect token == auth_token

  expect chan_state == channel_state.TryOpen

  expect counterparty.channel_id != ""

  expect and {
      next_sequence_send == 1,
      next_sequence_recv == 1,
      next_sequence_ack == 1,
    }

  expect and {
      dict.is_empty(packet_commitment),
      dict.is_empty(packet_receipt),
      dict.is_empty(packet_acknowledgement),
    }

  True
}

pub fn is_channel_open_ack_valid(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let ChannelDatumState { channel: input_chan, .. } = input_datum.state

  // input's Channel is Init state
  expect input_chan.state == channel_state.Init

  let ChannelDatumState { channel: output_chan, .. } = output_datum.state

  // output's Channel is updated correctly
  let output_counterpary_chan_id = output_chan.counterparty.channel_id
  expect output_counterpary_chan_id != ""

  expect channel.validate_basic(output_chan)

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_chan,
          state: channel_state.Open,
          counterparty: ChannelCounterparty {
            ..input_chan.counterparty,
            channel_id: output_counterpary_chan_id,
          },
        },
      },
    }

  expected_datum == output_datum
}

pub fn is_channel_open_confirm_valid(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  // input's Channel is Init state
  expect input_datum.state.channel.state == channel_state.TryOpen

  expect channel.validate_basic(output_datum.state.channel)

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Open,
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_recv_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  ack: ByteArray,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_receipt: dict.insert(
          input_datum.state.packet_receipt,
          packet.sequence,
          "",
          int.compare,
        ),
        packet_acknowledgement: dict.insert(
          input_datum.state.packet_acknowledgement,
          packet.sequence,
          ack,
          int.compare,
        ),
      },
    }

  expected_datum == output_datum
}
