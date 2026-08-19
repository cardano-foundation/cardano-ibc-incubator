use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Open}

fn setup(sequence: Int) -> (ChannelDatum, ChannelDatum, Packet) {
  let channel =
    channel_mod.new(
      Open,
      Unordered,
      ChannelCounterparty { port_id: "bank", channel_id: "channel-90" },
      ["connection-1"],
      "ics20-1",
    )
  let input =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: sequence,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
      },
      port_id: "port-1",
      token: AuthToken { policy_id: "policy", name: "token" },
    }
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        next_sequence_send: sequence + 1,
      },
    }
  let packet =
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
  (input, output, packet)
}

test succeeds_for_next_sequence() {
  let (input, output, packet) = setup(1)
  channel_datum_mod.validate_send_packet(input, output, packet)
}

test succeeds_beyond_old_capacity() {
  let (input, output, packet) = setup(1_000)
  channel_datum_mod.validate_send_packet(input, output, packet)
}

test rejects_wrong_successor() {
  let (input, _, packet) = setup(1)
  channel_datum_mod.validate_send_packet(input, input, packet) == False
}
