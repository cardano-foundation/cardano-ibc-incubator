use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod

fn setup() -> Packet {
  Packet {
    sequence: 11,
    source_port: "port-100",
    source_channel: "channel-10",
    destination_port: "transfer",
    destination_channel: "channel-99",
    data: "mock data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 9999,
  }
}

test succeed() {
  let packet = setup()

  packet_mod.validate_basic(packet)
}

test fail_if_source_port_invalid() fail {
  let packet = setup()

  let packet = Packet { ..packet, source_port: "invalid port !@#" }

  packet_mod.validate_basic(packet)
}

test fail_if_destination_port_invalid() fail {
  let packet = setup()

  let packet = Packet { ..packet, destination_port: "invalid port !@#" }

  packet_mod.validate_basic(packet)
}

test fail_if_source_channel_invalid() fail {
  let packet = setup()

  let packet = Packet { ..packet, source_channel: "invalid channel !@#" }

  packet_mod.validate_basic(packet)
}

test fail_if_destination_channel_invalid() fail {
  let packet = setup()

  let packet = Packet { ..packet, destination_channel: "invalid channel !@#" }

  packet_mod.validate_basic(packet)
}

test fail_if_sequence_not_greater_than_zero() fail {
  let packet = setup()

  let packet = Packet { ..packet, sequence: 0 }

  packet_mod.validate_basic(packet)
}

test fail_if_timeout_height_is_invalid_height() fail {
  let packet = setup()

  let packet =
    Packet { ..packet, timeout_height: height_mod.new_height(-1, -1) }

  packet_mod.validate_basic(packet)
}

test fail_if_timeout_timestamp_is_invalid() fail {
  let packet = setup()

  let packet = Packet { ..packet, timeout_timestamp: -1 }

  packet_mod.validate_basic(packet)
}

test fail_if_both_timeout_height_and_timestamp_is_zero() fail {
  let packet = setup()

  let packet =
    Packet {
      ..packet,
      timeout_timestamp: 0,
      timeout_height: height_mod.zero_height(),
    }

  packet_mod.validate_basic(packet)
}

test fail_if_data_is_empty() fail {
  let packet = setup()

  let packet = Packet { ..packet, data: "" }

  packet_mod.validate_basic(packet)
}
