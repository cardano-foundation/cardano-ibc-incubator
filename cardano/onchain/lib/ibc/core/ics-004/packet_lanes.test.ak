use aiken/collection/list
use ibc/core/ics_004/packet_lanes

test packet_lane_wire_vectors() {
  and {
    list.map(
      [1, 2, 3, 4, 5],
      fn(sequence) {
        packet_lanes.packet_lane("transfer", "channel-0", sequence, 16)
      },
    ) == [7, 14, 6, 15, 12],
    packet_lanes.lane_token_name("transfer", "channel-0", 0, 16) == #"31f732290ccec0a1b9dd878576dcfb232fd4b3a07125c849c0473fe61768d1c8",
    packet_lanes.sequencer_token_name("transfer", "channel-0") == #"cf6734b7a7e0f38bb24b4570cc7dac2ad272d260116e9336afae5ee8c1495a1e",
    packet_lanes.liquidity_token_name(
      "transfer",
      "channel-0",
      "lovelace",
      #"abababababababababababababababababababababababababababababababab",
      3,
    ) == #"739f68318d16ddd05518b4e0ad566b84b70300fce1ed528db92913d5bd634e8a",
  }
}

test packet_lane_rejects_zero_sequence() fail {
  packet_lanes.packet_lane("transfer", "channel-0", 0, 16) == 0
}

test packet_lane_rejects_alias_channel() fail {
  packet_lanes.packet_lane("transfer", "channel-00", 1, 16) == 0
}

test packet_lane_rejects_overflow() fail {
  packet_lanes.packet_lane(
    "transfer",
    "channel-0",
    18_446_744_073_709_551_616,
    16,
  ) == 0
}

test packet_lane_rejects_invalid_count() fail {
  packet_lanes.packet_lane("transfer", "channel-0", 1, 65) == 0
}
