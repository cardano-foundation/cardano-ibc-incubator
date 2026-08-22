use aiken/collection/pairs
use aiken/primitive/int
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{
  ChannelActive, ChannelDatum, ChannelDatumState,
} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Open}

fn packet_entries(
  sequence: Int,
  last_sequence: Int,
  value: ByteArray,
) -> Pairs<Int, ByteArray> {
  if sequence > last_sequence {
    []
  } else {
    [
      Pair(sequence, value),
      ..packet_entries(sequence + 1, last_sequence, value)
    ]
  }
}

fn setup_unordered_channel() -> (ChannelDatum, ChannelDatum, Packet, ByteArray) {
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

  let ack = "mock ack"

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
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
      lifecycle: ChannelActive,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [
          Pair(packet.sequence, ""),
          ..input_channel_datum.state.packet_receipt
        ],
        packet_acknowledgement: [
          Pair(packet.sequence, ack),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  (input_channel_datum, output_channel_datum, packet, ack)
}

fn setup_ordered_channel() -> (ChannelDatum, ChannelDatum, Packet, ByteArray) {
  let mock_auth_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let input_channel =
    channel_mod.new(
      Open,
      Ordered,
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

  let ack = "mock ack"

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: packet.sequence,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-1",
      token: mock_auth_token,
      lifecycle: ChannelActive,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        next_sequence_recv: input_channel_datum.state.next_sequence_recv + 1,
        packet_acknowledgement: [
          Pair(packet.sequence, ack),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  (input_channel_datum, output_channel_datum, packet, ack)
}

test succeed_with_unordered_channel() {
  let (input_datum, output_datum, packet, ack) = setup_unordered_channel()

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_if_packet_receipt_not_updated_with_unordered_channel() {
  let (input_datum, output_datum, packet, ack) = setup_unordered_channel()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        packet_receipt: input_datum.state.packet_receipt,
      },
    }

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test succeed_with_ordered_channel() {
  let (input_datum, output_datum, packet, ack) = setup_ordered_channel()

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_if_packet_sequence_does_not_match_ordered_next_sequence_recv() {
  let (input_datum, output_datum, packet, ack) = setup_ordered_channel()
  let wrong_packet = Packet { ..packet, sequence: packet.sequence + 1 }

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    wrong_packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_if_next_sequence_recv_not_updated_with_ordered_channel() {
  let (input_datum, output_datum, packet, ack) = setup_ordered_channel()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        next_sequence_recv: input_datum.state.next_sequence_recv,
      },
    }

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_if_packet_acknowledgement_not_updated() {
  let (input_datum, output_datum, packet, ack) = setup_ordered_channel()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        packet_acknowledgement: input_datum.state.packet_acknowledgement,
      },
    }

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test succeed_at_packet_history_capacity() {
  let (base_input_datum, _, base_packet, ack) = setup_unordered_channel()
  let sequence = channel_datum_mod.max_packet_entries_per_channel / 2
  let packet = Packet { ..base_packet, sequence }
  let existing_receipts = packet_entries(1, sequence - 1, "")
  let existing_acks = packet_entries(1, sequence - 1, "existing ack")
  let input_datum =
    ChannelDatum {
      ..base_input_datum,
      state: ChannelDatumState {
        ..base_input_datum.state,
        packet_receipt: existing_receipts,
        packet_acknowledgement: existing_acks,
      },
    }
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_receipt: [Pair(sequence, ""), ..existing_receipts],
        packet_acknowledgement: pairs.insert_by_ascending_key(
          existing_acks,
          sequence,
          ack,
          int.compare,
        ),
      },
    }

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_when_unordered_receipt_capacity_is_exhausted() fail {
  let (base_input_datum, _, base_packet, ack) = setup_unordered_channel()
  let sequence = channel_datum_mod.max_packet_entries_per_channel + 1
  let packet = Packet { ..base_packet, sequence }
  let existing_receipts =
    packet_entries(1, channel_datum_mod.max_packet_entries_per_channel, "")
  let input_datum =
    ChannelDatum {
      ..base_input_datum,
      state: ChannelDatumState {
        ..base_input_datum.state,
        packet_receipt: existing_receipts,
      },
    }
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_receipt: [Pair(sequence, ""), ..existing_receipts],
        packet_acknowledgement: [Pair(sequence, ack)],
      },
    }

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test fail_when_acknowledgement_capacity_is_exhausted() fail {
  let (base_input_datum, _, base_packet, ack) = setup_ordered_channel()
  let sequence = channel_datum_mod.max_packet_entries_per_channel + 1
  let packet = Packet { ..base_packet, sequence }
  let existing_acks =
    packet_entries(
      1,
      channel_datum_mod.max_packet_entries_per_channel,
      "existing ack",
    )
  let input_datum =
    ChannelDatum {
      ..base_input_datum,
      state: ChannelDatumState {
        ..base_input_datum.state,
        packet_acknowledgement: existing_acks,
      },
    }
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        next_sequence_recv: input_datum.state.next_sequence_recv + 1,
        packet_acknowledgement: pairs.insert_by_ascending_key(
          existing_acks,
          sequence,
          ack,
          int.compare,
        ),
      },
    }

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    height_mod.zero_height(),
  )
}

test receive_advances_revision_aware_high_water_mark() {
  let (base_input, base_output, packet, ack) = setup_unordered_channel()
  let old_maximum = height_mod.new_height(1, 100)
  let proof_height = height_mod.new_height(2, 1)
  let input_datum =
    ChannelDatum {
      ..base_input,
      state: ChannelDatumState {
        ..base_input.state,
        maximum_receive_proof_height: old_maximum,
      },
    }
  let output_datum =
    ChannelDatum {
      ..base_output,
      state: ChannelDatumState {
        ..base_output.state,
        maximum_receive_proof_height: proof_height,
      },
    }

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    proof_height,
  )
}

test out_of_order_receive_above_floor_preserves_higher_high_water_mark() {
  let (base_input, base_output, packet, ack) = setup_unordered_channel()
  let floor = height_mod.new_height(1, 5)
  let maximum = height_mod.new_height(2, 10)
  let proof_height = height_mod.new_height(1, 9)
  let input_datum =
    ChannelDatum {
      ..base_input,
      state: ChannelDatumState {
        ..base_input.state,
        minimum_receive_proof_height: floor,
        maximum_receive_proof_height: maximum,
      },
    }
  let output_datum =
    ChannelDatum {
      ..base_output,
      state: ChannelDatumState {
        ..base_output.state,
        minimum_receive_proof_height: floor,
        maximum_receive_proof_height: maximum,
      },
    }

  channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    proof_height,
  )
}

test receive_rejects_proof_below_revision_aware_floor() {
  let (base_input, base_output, packet, ack) = setup_unordered_channel()
  let floor = height_mod.new_height(2, 1)
  let stale_proof_height = height_mod.new_height(1, 999_999)
  let input_datum =
    ChannelDatum {
      ..base_input,
      state: ChannelDatumState {
        ..base_input.state,
        minimum_receive_proof_height: floor,
      },
    }
  let output_datum =
    ChannelDatum {
      ..base_output,
      state: ChannelDatumState {
        ..base_output.state,
        minimum_receive_proof_height: floor,
        maximum_receive_proof_height: stale_proof_height,
      },
    }

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    stale_proof_height,
  )
}

test receive_rejects_successor_that_does_not_raise_high_water_mark() {
  let (input_datum, output_datum, packet, ack) = setup_unordered_channel()
  let proof_height = height_mod.new_height(1, 10)

  !channel_datum_mod.validate_recv_packet(
    input_datum,
    output_datum,
    packet,
    ack,
    proof_height,
  )
}
