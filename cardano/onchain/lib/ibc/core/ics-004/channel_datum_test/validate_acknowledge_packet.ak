use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Open}

fn datum(ordering: Order, next_ack: Int) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        Open,
        ordering,
        ChannelCounterparty { port_id: "bank", channel_id: "channel-90" },
        ["connection-1"],
        "ics20-1",
      ),
      next_sequence_send: 2,
      next_sequence_recv: 1,
      next_sequence_ack: next_ack,
    },
    port_id: "port-1",
    token: AuthToken { policy_id: "policy", name: "token" },
  }
}

fn packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "port-1",
    source_channel: "channel-0",
    destination_port: "bank",
    destination_channel: "channel-90",
    data: "data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 100,
  }
}

test unordered_ack_keeps_fixed_size_datum() {
  let state = datum(Unordered, 1)
  channel_datum_mod.validate_acknowledge_packet(state, state, packet(1))
}

test ordered_ack_increments_sequence() {
  let input = datum(Ordered, 1)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_ack: 2 },
    }
  channel_datum_mod.validate_acknowledge_packet(input, output, packet(1))
}

test ordered_ack_rejects_unrelated_mutation() {
  let input = datum(Ordered, 1)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        next_sequence_ack: 2,
        next_sequence_recv: 2,
      },
    }
  !channel_datum_mod.validate_acknowledge_packet(input, output, packet(1))
}
