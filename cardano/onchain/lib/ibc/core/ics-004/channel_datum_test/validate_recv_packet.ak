use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Open}

fn datum(ordering: Order, next_recv: Int) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        Open,
        ordering,
        ChannelCounterparty { port_id: "bank", channel_id: "channel-90" },
        ["connection-1"],
        "ics20-1",
      ),
      next_sequence_send: 1,
      next_sequence_recv: next_recv,
      next_sequence_ack: 1,
    },
    port_id: "port-1",
    token: AuthToken { policy_id: "policy", name: "token" },
  }
}

fn packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "bank",
    source_channel: "channel-90",
    destination_port: "port-1",
    destination_channel: "channel-0",
    data: "data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 100,
  }
}

test unordered_receive_has_constant_size_datum() {
  let state = datum(Unordered, 1)
  channel_datum_mod.validate_recv_packet(state, state, packet(10_000))
}

test ordered_receive_increments_sequence() {
  let input = datum(Ordered, 4)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_recv: 5 },
    }
  channel_datum_mod.validate_recv_packet(input, output, packet(4))
}

test ordered_receive_rejects_replay() {
  let input = datum(Ordered, 5)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_recv: 6 },
    }
  !channel_datum_mod.validate_recv_packet(input, output, packet(4))
}
