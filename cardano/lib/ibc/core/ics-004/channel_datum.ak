use aiken/collection/list
use aiken/collection/pairs
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_024_host_requirements/validate as host_validate_mod

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
  packet_commitment: Pairs<Int, ByteArray>,
  packet_receipt: Pairs<Int, ByteArray>,
  packet_acknowledgement: Pairs<Int, ByteArray>,
}

pub fn validate_chan_open_init(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, port_id, token } = datum

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
      list.is_empty(packet_commitment),
      list.is_empty(packet_receipt),
      list.is_empty(packet_acknowledgement),
    }

  expect port_keys_mod.is_valid_port_id(port_id)

  True
}

pub fn validate_chan_open_try(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, port_id, token } = datum

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
      list.is_empty(packet_commitment),
      list.is_empty(packet_receipt),
      list.is_empty(packet_acknowledgement),
    }

  expect port_keys_mod.is_valid_port_id(port_id)

  True
}

pub fn validate_chan_open_ack(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let ChannelDatumState { channel: input_chan, .. } = input_datum.state

  // input's Channel is Init state
  expect input_chan.state == channel_state.Init

  let ChannelDatumState { channel: output_chan, .. } = output_datum.state

  // output's Channel is updated correctly
  let output_counterpary_chan_id = output_chan.counterparty.channel_id

  expect
    host_validate_mod.channel_identifier_validator(output_counterpary_chan_id)

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

pub fn validate_chan_open_confirm(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  // input's Channel is Init state
  expect input_datum.state.channel.state == channel_state.TryOpen

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

pub fn validate_chan_close_init(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Closed,
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_chan_close_confirm(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Closed,
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
  let (expected_packet_receipt, expected_next_sequence_recv) =
    when input_datum.state.channel.ordering is {
      order.Ordered ->
        (
          input_datum.state.packet_receipt,
          input_datum.state.next_sequence_recv + 1,
        )
      order.Unordered ->
        (
          [Pair(packet.sequence, ""), ..input_datum.state.packet_receipt],
          input_datum.state.next_sequence_recv,
        )
      _ -> fail
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        next_sequence_recv: expected_next_sequence_recv,
        packet_receipt: expected_packet_receipt,
        packet_acknowledgement: [
          Pair(packet.sequence, ack),
          ..input_datum.state.packet_acknowledgement
        ],
      },
    }

  expected_datum == output_datum
}

pub fn validate_send_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  commitment: ByteArray,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        next_sequence_send: input_datum.state.next_sequence_send + 1,
        packet_commitment: [
          Pair(packet.sequence, commitment),
          ..input_datum.state.packet_commitment
        ],
      },
    }

  expected_datum == output_datum
}

pub fn validate_timeout_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
) -> Bool {
  let expected_channel_state =
    if input_datum.state.channel.ordering == order.Ordered {
      channel_state.Closed
    } else {
      channel_state.Open
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: expected_channel_state,
        },
        packet_commitment: pairs.delete_first(
          input_datum.state.packet_commitment,
          packet.sequence,
        ),
      },
    }

  expected_datum == output_datum
}

pub fn validate_acknowledge_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
) -> Bool {
  let expected_next_seq_ack =
    if input_datum.state.channel.ordering == order.Ordered {
      input_datum.state.next_sequence_ack + 1
    } else {
      input_datum.state.next_sequence_ack
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_commitment: pairs.delete_first(
          input_datum.state.packet_commitment,
          packet.sequence,
        ),
        next_sequence_ack: expected_next_seq_ack,
      },
    }

  expected_datum == output_datum
}

pub fn validate_refresh_utxo(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  input_datum == output_datum
}
