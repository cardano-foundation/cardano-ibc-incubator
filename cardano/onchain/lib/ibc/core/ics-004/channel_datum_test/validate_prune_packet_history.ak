use aiken/collection/pairs
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{
  ChannelActive, ChannelDatum, ChannelDatumState,
} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Closed, Init, Open}

const sequence = 11

const acknowledgement = "acknowledgement commitment"

fn packet_entries(first: Int, last: Int, value: ByteArray) {
  if first > last {
    []
  } else {
    [Pair(first, value), ..packet_entries(first + 1, last, value)]
  }
}

fn input_datum() -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        Open,
        Unordered,
        ChannelCounterparty { port_id: "bank", channel_id: "channel-90" },
        ["connection-1"],
        "ics20-1",
      ),
      next_sequence_send: 3,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment: [Pair(2, "unrelated outbound commitment")],
      packet_receipt: [Pair(sequence, "")],
      packet_acknowledgement: [Pair(sequence, acknowledgement)],
      minimum_receive_proof_height: height_mod.new_height(1, 5),
      maximum_receive_proof_height: height_mod.new_height(1, 10),
    },
    port_id: "transfer",
    token: AuthToken { policy_id: "policy", name: "channel token" },
    lifecycle: ChannelActive,
  }
}

fn expected_output(input: ChannelDatum, proof_height: height_mod.Height) {
  ChannelDatum {
    ..input,
    state: ChannelDatumState {
      ..input.state,
      packet_receipt: if input.state.channel.ordering == Ordered {
        input.state.packet_receipt
      } else {
        pairs.delete_first(input.state.packet_receipt, sequence)
      },
      packet_acknowledgement: pairs.delete_first(
        input.state.packet_acknowledgement,
        sequence,
      ),
      minimum_receive_proof_height: proof_height,
    },
  }
}

test prune_deletes_both_entries_and_advances_only_floor() {
  let input = input_datum()
  let proof_height = height_mod.new_height(1, 12)
  let output = expected_output(input, proof_height)

  channel_datum_mod.validate_prune_packet_history(
    input,
    output,
    sequence,
    proof_height,
  )
}

test prune_works_at_packet_history_capacity() {
  let base = input_datum()
  let half = channel_datum_mod.max_packet_entries_per_channel / 2
  let receipts = packet_entries(1, half, "")
  let acknowledgements = packet_entries(1, half, acknowledgement)
  let input =
    ChannelDatum {
      ..base,
      state: ChannelDatumState {
        ..base.state,
        packet_commitment: [],
        packet_receipt: receipts,
        packet_acknowledgement: acknowledgements,
      },
    }
  let proof_height = height_mod.new_height(1, 12)
  let output =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        packet_receipt: pairs.delete_first(receipts, sequence),
        packet_acknowledgement: pairs.delete_first(acknowledgements, sequence),
        minimum_receive_proof_height: proof_height,
      },
    }

  and {
    channel_datum_mod.packet_entry_count(input.state) == channel_datum_mod.max_packet_entries_per_channel,
    channel_datum_mod.validate_prune_packet_history(
      input,
      output,
      sequence,
      proof_height,
    ),
  }
}

test repeated_prune_at_same_height_succeeds_for_distinct_packets() {
  let base = input_datum()
  let second_sequence = sequence + 1
  let input =
    ChannelDatum {
      ..base,
      state: ChannelDatumState {
        ..base.state,
        packet_receipt: [Pair(sequence, ""), Pair(second_sequence, "")],
        packet_acknowledgement: [
          Pair(sequence, acknowledgement),
          Pair(second_sequence, acknowledgement),
        ],
      },
    }
  let proof_height = height_mod.new_height(1, 12)
  let after_first =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        packet_receipt: [Pair(second_sequence, "")],
        packet_acknowledgement: [Pair(second_sequence, acknowledgement)],
        minimum_receive_proof_height: proof_height,
      },
    }
  let after_second =
    ChannelDatum {
      ..after_first,
      state: ChannelDatumState {
        ..after_first.state,
        packet_receipt: [],
        packet_acknowledgement: [],
      },
    }

  and {
    channel_datum_mod.validate_prune_packet_history(
      input,
      after_first,
      sequence,
      proof_height,
    ),
    channel_datum_mod.validate_prune_packet_history(
      after_first,
      after_second,
      second_sequence,
      proof_height,
    ),
  }
}

test prune_rejects_missing_receipt() {
  let input = input_datum()
  let invalid_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, packet_receipt: [] },
    }
  let proof_height = height_mod.new_height(1, 12)

  !channel_datum_mod.validate_prune_packet_history(
    invalid_input,
    expected_output(invalid_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_rejects_missing_acknowledgement() {
  let input = input_datum()
  let invalid_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState { ..input.state, packet_acknowledgement: [] },
    }
  let proof_height = height_mod.new_height(1, 12)

  !channel_datum_mod.validate_prune_packet_history(
    invalid_input,
    expected_output(invalid_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_rejects_floor_regression_across_revisions() {
  let input = input_datum()
  let current_floor = height_mod.new_height(2, 1)
  let stale_height = height_mod.new_height(1, 999_999)
  let input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        minimum_receive_proof_height: current_floor,
        maximum_receive_proof_height: current_floor,
      },
    }

  !channel_datum_mod.validate_prune_packet_history(
    input,
    expected_output(input, stale_height),
    sequence,
    stale_height,
  )
}

test prune_rejects_absence_proof_predating_receive_high_water() {
  let input = input_datum()
  let stale_height = height_mod.new_height(1, 9)

  !channel_datum_mod.validate_prune_packet_history(
    input,
    expected_output(input, stale_height),
    sequence,
    stale_height,
  )
}

test prune_rejects_wrong_sequence() {
  let input = input_datum()
  let proof_height = height_mod.new_height(1, 12)

  !channel_datum_mod.validate_prune_packet_history(
    input,
    expected_output(input, proof_height),
    sequence + 1,
    proof_height,
  )
}

test prune_ordered_channel_deletes_acknowledgement_only() {
  let input = input_datum()
  let ordered_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel { ..input.state.channel, ordering: Ordered },
        packet_receipt: [],
      },
    }
  let proof_height = height_mod.new_height(1, 12)

  channel_datum_mod.validate_prune_packet_history(
    ordered_input,
    expected_output(ordered_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_succeeds_on_closed_unordered_channel() {
  let input = input_datum()
  let closed_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel { ..input.state.channel, state: Closed },
      },
    }
  let proof_height = height_mod.new_height(1, 12)

  channel_datum_mod.validate_prune_packet_history(
    closed_input,
    expected_output(closed_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_succeeds_on_closed_ordered_channel() {
  let input = input_datum()
  let closed_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel {
          ..input.state.channel,
          state: Closed,
          ordering: Ordered,
        },
        packet_receipt: [],
      },
    }
  let proof_height = height_mod.new_height(1, 12)

  channel_datum_mod.validate_prune_packet_history(
    closed_input,
    expected_output(closed_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_rejects_handshake_channel() {
  let input = input_datum()
  let handshake_input =
    ChannelDatum {
      ..input,
      state: ChannelDatumState {
        ..input.state,
        channel: Channel { ..input.state.channel, state: Init },
      },
    }
  let proof_height = height_mod.new_height(1, 12)

  !channel_datum_mod.validate_prune_packet_history(
    handshake_input,
    expected_output(handshake_input, proof_height),
    sequence,
    proof_height,
  )
}

test prune_rejects_unrelated_outbound_commitment_mutation() {
  let input = input_datum()
  let proof_height = height_mod.new_height(1, 12)
  let valid_output = expected_output(input, proof_height)
  let invalid_output =
    ChannelDatum {
      ..valid_output,
      state: ChannelDatumState { ..valid_output.state, packet_commitment: [] },
    }

  !channel_datum_mod.validate_prune_packet_history(
    input,
    invalid_output,
    sequence,
    proof_height,
  )
}

test old_membership_height_cannot_replay_after_prune() {
  let base = input_datum()
  let packet =
    Packet {
      sequence,
      source_port: base.state.channel.counterparty.port_id,
      source_channel: base.state.channel.counterparty.channel_id,
      destination_port: base.port_id,
      destination_channel: "channel-1",
      data: "packet data",
      timeout_height: height_mod.zero_height(),
      timeout_timestamp: 100,
    }
  let before_receive =
    ChannelDatum {
      ..base,
      state: ChannelDatumState {
        ..base.state,
        packet_receipt: [],
        packet_acknowledgement: [],
        minimum_receive_proof_height: height_mod.zero_height(),
        maximum_receive_proof_height: height_mod.zero_height(),
      },
    }
  let receive_height = height_mod.new_height(1, 10)
  let after_receive =
    ChannelDatum {
      ..before_receive,
      state: ChannelDatumState {
        ..before_receive.state,
        packet_receipt: [Pair(sequence, "")],
        packet_acknowledgement: [Pair(sequence, acknowledgement)],
        maximum_receive_proof_height: receive_height,
      },
    }
  let prune_height = height_mod.new_height(1, 12)
  let after_prune = expected_output(after_receive, prune_height)
  let replay_successor =
    ChannelDatum {
      ..after_prune,
      state: ChannelDatumState {
        ..after_prune.state,
        packet_receipt: [Pair(sequence, "")],
        packet_acknowledgement: [Pair(sequence, acknowledgement)],
      },
    }

  and {
    channel_datum_mod.validate_recv_packet(
      before_receive,
      after_receive,
      packet,
      acknowledgement,
      receive_height,
    ),
    channel_datum_mod.validate_prune_packet_history(
      after_receive,
      after_prune,
      sequence,
      prune_height,
    ),
    !channel_datum_mod.validate_recv_packet(
      after_prune,
      replay_successor,
      packet,
      acknowledgement,
      receive_height,
    ),
  }
}
