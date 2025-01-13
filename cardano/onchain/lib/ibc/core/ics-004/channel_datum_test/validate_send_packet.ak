use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state.{Open}

fn setup() -> (ChannelDatum, ChannelDatum, Packet, ByteArray) {
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
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
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
        next_sequence_send: input_channel_datum.state.next_sequence_send + 1,
        packet_commitment: [
          Pair(packet.sequence, commitment),
          ..input_channel_datum.state.packet_commitment
        ],
      },
    }

  (input_channel_datum, output_channel_datum, packet, commitment)
}

test succeed() {
  let (input_datum, output_datum, packet, commitment) = setup()

  channel_datum_mod.validate_send_packet(
    input_datum,
    output_datum,
    packet,
    commitment,
  )
}

test fail_if_next_sequence_send_not_updated() {
  let (input_datum, output_datum, packet, commitment) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        next_sequence_send: input_datum.state.next_sequence_send,
      },
    }

  !channel_datum_mod.validate_send_packet(
    input_datum,
    output_datum,
    packet,
    commitment,
  )
}

test fail_if_packet_commitment_not_updated() {
  let (input_datum, output_datum, packet, commitment) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        packet_commitment: input_datum.state.packet_commitment,
      },
    }

  !channel_datum_mod.validate_send_packet(
    input_datum,
    output_datum,
    packet,
    commitment,
  )
}
