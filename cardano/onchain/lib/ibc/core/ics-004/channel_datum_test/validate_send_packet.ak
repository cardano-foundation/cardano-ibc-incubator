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
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: input_channel_datum.state.next_sequence_send + 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [Pair(packet.sequence, commitment)],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-1",
      token: mock_auth_token,
    }

  (input_channel_datum, output_channel_datum, packet, commitment)
}

test succeed() {
  let input_datum_2 =
    ChannelDatum {
      state: ChannelDatumState {
        channel: channel_mod.new(
          Open,
          Unordered,
          counterparty: ChannelCounterparty {
            port_id: "transfer",
            channel_id: "channel-3",
          },
          connection_hops: ["connection-1"],
          version: "ics20-1",
        ),
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-100",
      token: AuthToken {
        policy_id: #"0151eb42845171292d1342cdcf9ccd2a4e6236244e00dd6ccd4e826c",
        name: #"5217438dba7f0c1bedaeae4c467cbd01ff45d62c239b722031",
      },
    }

  let output_datum_2 =
    ChannelDatum {
      state: ChannelDatumState {
        channel: channel_mod.new(
          Open,
          Unordered,
          counterparty: ChannelCounterparty {
            port_id: "transfer",
            channel_id: "channel-3",
          },
          connection_hops: ["connection-1"],
          version: "ics20-1",
        ),
        next_sequence_send: 2,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [
          Pair(
            1,
            #"cf05032bc48756bdcb33b75937b4462a313732794b9573c6fd40e0690dd35d26",
          ),
        ],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-100",
      token: AuthToken {
        policy_id: #"0151eb42845171292d1342cdcf9ccd2a4e6236244e00dd6ccd4e826c",
        name: #"5217438dba7f0c1bedaeae4c467cbd01ff45d62c239b722031",
      },
    }

  let packet_2 =
    Packet {
      sequence: 1,
      source_port: #"706f72742d313030",
      source_channel: #"6368616e6e656c2d31",
      destination_port: "transfer",
      destination_channel: "channel-3",
      data: #"7b22616d6f756e74223a2231303030222c2264656e6f6d223a2234363532303931393566323763393964666566646362373235653933396164333236323333396139623135303939326236363637336265383664366636333662222c227265636569766572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36222c2273656e646572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238227d",
      timeout_height: height_mod.zero_height(),
      timeout_timestamp: 1749555153208041341,
    }

  trace @"input_datum_2": input_datum_2
  trace @"output_datum_2": output_datum_2
  trace @"packet_2": packet_2

  channel_datum_mod.validate_send_packet(
    input_datum_2,
    output_datum_2,
    packet_2,
    #"cf05032bc48756bdcb33b75937b4462a313732794b9573c6fd40e0690dd35d26",
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
