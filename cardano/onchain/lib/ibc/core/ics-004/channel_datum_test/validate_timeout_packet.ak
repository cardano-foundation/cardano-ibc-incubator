use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Closed, Open}

fn datum(ordering: Order) -> ChannelDatum {
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
      next_sequence_ack: 1,
    },
    port_id: "port-1",
    token: AuthToken { policy_id: "policy", name: "token" },
  }
}

fn packet() -> Packet {
  Packet {
    sequence: 1,
    source_port: "port-1",
    source_channel: "channel-0",
    destination_port: "bank",
    destination_channel: "channel-90",
    data: "data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 100,
  }
}

test unordered_timeout_keeps_channel_open() {
  let state = datum(Unordered)
  channel_datum_mod.validate_timeout_packet(state, state, packet())
}

test ordered_timeout_closes_channel() {
  let input = datum(Ordered)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel { ..input.state.channel, state: Closed },
      },
    }
  channel_datum_mod.validate_timeout_packet(input, output, packet())
}

test timeout_rejects_unrelated_mutation() {
  let input = datum(Unordered)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, next_sequence_send: 3 },
    }
  !channel_datum_mod.validate_timeout_packet(input, output, packet())
}
