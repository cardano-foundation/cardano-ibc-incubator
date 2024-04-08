use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod

test succeed() {
  packet_mod.commit_packet(
    Packet {
      sequence: 11,
      source_port: "port-100",
      source_channel: "channel-10",
      destination_port: "transfer",
      destination_channel: "channel-99",
      data: "mock data",
      timeout_height: height_mod.zero_height(),
      timeout_timestamp: 9999,
    },
  ) == #"38c3b06d40da007bb1d835bef0871cbbf2608025fcbee2e2c83d11ce79e5a848"
}
