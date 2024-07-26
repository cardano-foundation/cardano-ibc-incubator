use aiken/pairs
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state.{Open}

fn setup_unordered() -> (ChannelDatum, ChannelDatum, Packet) {
  let mock_auth_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let input_channel =
    channel_mod.new(
      Open,
      Unordered,
      counterparty: ChannelCounterparty {
        port_id: "bank",
        channel_id: "channel-90",
      },
      connection_hops: ["connection-1"],
      version: "ics20-1",
    )

  let packet =
    Packet {
      sequence: 11,
      source_port: "port-100",
      source_channel: "channel-1",
      destination_port: input_channel.counterparty.port_id,
      destination_channel: input_channel.counterparty.channel_id,
      data: "mock data",
      timeout_height: height_mod.zero_height(),
      timeout_timestamp: 100,
    }

  let commitment = packet_mod.commit_packet(packet)

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: packet.sequence + 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [Pair(packet.sequence, commitment)],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-1",
      token: mock_auth_token,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_commitment: pairs.remove_first(
          input_channel_datum.state.packet_commitment,
          packet.sequence,
        ),
      },
    }

  (input_channel_datum, output_channel_datum, packet)
}

fn setup_ordered() -> (ChannelDatum, ChannelDatum, Packet) {
  let (input_datum, output_datum, packet) = setup_unordered()

  let input_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel { ..input_datum.state.channel, ordering: Ordered },
      },
    }

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        channel: Channel { ..output_datum.state.channel, ordering: Ordered },
        next_sequence_ack: input_datum.state.next_sequence_ack + 1,
      },
    }

  (input_datum, output_datum, packet)
}

test succeed_with_unordered_channel() {
  let (input_datum, output_datum, packet) = setup_unordered()

  channel_datum_mod.validate_acknowledge_packet(
    input_datum,
    output_datum,
    packet,
  )
}

test succeed_with_ordered_channel() {
  let (input_datum, output_datum, packet) = setup_ordered()

  channel_datum_mod.validate_acknowledge_packet(
    input_datum,
    output_datum,
    packet,
  )
}

test fail_if_next_sequence_ack_not_updated_with_ordered_channel() {
  let (input_datum, output_datum, packet) = setup_ordered()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        next_sequence_ack: input_datum.state.next_sequence_ack,
      },
    }

  !channel_datum_mod.validate_acknowledge_packet(
    input_datum,
    output_datum,
    packet,
  )
}

test fail_if_packet_commitment_not_removed() {
  let (input_datum, output_datum, packet) = setup_unordered()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        packet_commitment: input_datum.state.packet_commitment,
      },
    }

  !channel_datum_mod.validate_acknowledge_packet(
    input_datum,
    output_datum,
    packet,
  )
}
