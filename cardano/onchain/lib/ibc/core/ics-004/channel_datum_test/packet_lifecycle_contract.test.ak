use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Closed, Open}

fn base_datum(ordering: Order, next_sequence_send: Int) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        Open,
        ordering,
        counterparty: ChannelCounterparty {
          port_id: "bank",
          channel_id: "channel-90",
        },
        connection_hops: ["connection-1"],
        version: "ics20-1",
      ),
      next_sequence_send,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
    },
    port_id: "port-1",
    token: AuthToken { policy_id: "policy", name: "channel token" },
  }
}

fn packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "port-1",
    source_channel: "channel-0",
    destination_port: "bank",
    destination_channel: "channel-90",
    data: "packet data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 100,
  }
}

test send_advances_only_the_send_sequence() {
  let input = base_datum(Unordered, 7)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_send: 8 },
    }

  channel_datum_mod.validate_send_packet(input, output, packet(7))
}

test send_rejects_wrong_sequence() {
  let input = base_datum(Unordered, 7)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_send: 8 },
    }

  !channel_datum_mod.validate_send_packet(input, output, packet(8))
}

test send_supports_more_than_64_packet_lifecycles() {
  let input = base_datum(Unordered, 65)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_send: 66 },
    }

  channel_datum_mod.validate_send_packet(input, output, packet(65))
}

test unordered_receive_keeps_fixed_size_channel_state() {
  let datum = base_datum(Unordered, 1)
  channel_datum_mod.validate_recv_packet(datum, datum, packet(999))
}

test ordered_receive_advances_exact_sequence() {
  let input = base_datum(Ordered, 1)
  let inbound = Packet { ..packet(1), destination_port: input.port_id }
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_recv: 2 },
    }

  channel_datum_mod.validate_recv_packet(input, output, inbound)
}

test ordered_receive_rejects_replay_sequence() {
  let input =
    ChannelDatum {
      ..base_datum(Ordered, 1),
      state: ChannelDatumState {
        ..base_datum(Ordered, 1).state,
        next_sequence_recv: 2,
      },
    }
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_recv: 3 },
    }

  !channel_datum_mod.validate_recv_packet(input, output, packet(1))
}

test unordered_acknowledgement_keeps_fixed_size_channel_state() {
  let datum = base_datum(Unordered, 1)
  channel_datum_mod.validate_acknowledge_packet(datum, datum, packet(1))
}

test ordered_acknowledgement_advances_ack_sequence() {
  let input = base_datum(Ordered, 1)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_ack: 2 },
    }

  channel_datum_mod.validate_acknowledge_packet(input, output, packet(1))
}

test unordered_timeout_keeps_channel_open() {
  let datum = base_datum(Unordered, 1)
  channel_datum_mod.validate_timeout_packet(datum, datum, packet(1))
}

test ordered_timeout_closes_channel() {
  let input = base_datum(Ordered, 1)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel { ..input.state.channel, state: Closed },
      },
    }

  channel_datum_mod.validate_timeout_packet(input, output, packet(1))
}

test packet_transition_rejects_unrelated_mutation() {
  let input = base_datum(Unordered, 7)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        next_sequence_send: 8,
        next_sequence_ack: 2,
      },
    }

  !channel_datum_mod.validate_send_packet(input, output, packet(7))
}
