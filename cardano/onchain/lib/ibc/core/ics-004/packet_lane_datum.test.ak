use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_lane_datum.{
  CommitPacket, CompletePacket, LaneUpdate, PacketLaneDatum, PrunePacket,
  ReceivePacket,
}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/testing/sparse_tree

fn packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "transfer",
    source_channel: "channel-0",
    destination_port: "transfer",
    destination_channel: "channel-0",
    data: "transfer data",
    timeout_height: Height { revision_number: 0, revision_height: 0 },
    timeout_timestamp: 100_000_000,
  }
}

fn height(value: Int) -> Height {
  Height { revision_number: 0, revision_height: value }
}

fn empty() -> PacketLaneDatum {
  packet_lane_datum.empty("transfer", "channel-0", 7, 16)
}

fn committed() -> PacketLaneDatum {
  let key = packet_keys.packet_commitment_path("transfer", "channel-0", 1)
  packet_lane_datum.apply_updates(
    empty(),
    [
      LaneUpdate {
        mutation: CommitPacket { packet: packet(1) },
        siblings: [sparse_tree.siblings([], key)],
      },
    ],
  )
}

fn received() -> PacketLaneDatum {
  let receipt = packet_keys.packet_receipt_path("transfer", "channel-0", 1)
  let ack = packet_keys.packet_acknowledgement_path("transfer", "channel-0", 1)
  packet_lane_datum.apply_updates(
    empty(),
    [
      LaneUpdate {
        mutation: ReceivePacket {
          packet: packet(1),
          acknowledgement: #"1111111111111111111111111111111111111111111111111111111111111111",
          proof_height: height(10),
        },
        siblings: [
          sparse_tree.siblings([], receipt),
          sparse_tree.siblings([Pair(receipt, #"01")], ack),
        ],
      },
    ],
  )
}

fn prune(datum: PacketLaneDatum, proof_height: Height) -> PacketLaneDatum {
  let receipt = packet_keys.packet_receipt_path("transfer", "channel-0", 1)
  let ack = packet_keys.packet_acknowledgement_path("transfer", "channel-0", 1)
  let ack_entry =
    Pair(
      ack,
      #"1111111111111111111111111111111111111111111111111111111111111111",
    )
  packet_lane_datum.apply_updates(
    datum,
    [
      LaneUpdate {
        mutation: PrunePacket { sequence: 1, proof_height },
        siblings: [
          sparse_tree.siblings([Pair(receipt, #"01"), ack_entry], receipt),
          sparse_tree.siblings([ack_entry], ack),
        ],
      },
    ],
  )
}

test packet_lane_exact_commitment_root() {
  let datum = committed()
  let key = packet_keys.packet_commitment_path("transfer", "channel-0", 1)
  and {
    datum.version == 1,
    datum.root == sparse_tree.root(
      [Pair(key, packet_mod.commit_packet(packet(1)))],
    ),
    datum.commitments == [Pair(1, packet_mod.commit_packet(packet(1)))],
  }
}

test packet_lane_completion_deletes_exact_commitment() {
  let datum = committed()
  let key = packet_keys.packet_commitment_path("transfer", "channel-0", 1)
  let next =
    packet_lane_datum.apply_updates(
      datum,
      [
        LaneUpdate {
          mutation: CompletePacket { packet: packet(1) },
          siblings: [
            sparse_tree.siblings(
              [Pair(key, packet_mod.commit_packet(packet(1)))],
              key,
            ),
          ],
        },
      ],
    )
  next == PacketLaneDatum { ..empty(), version: 2 }
}

test packet_lane_cannot_modify_another_lane() fail {
  let key = packet_keys.packet_commitment_path("transfer", "channel-0", 2)
  expect _ =
    packet_lane_datum.apply_updates(
      empty(),
      [
        LaneUpdate {
          mutation: CommitPacket { packet: packet(2) },
          siblings: [sparse_tree.siblings([], key)],
        },
      ],
    )
}

test packet_lane_cannot_replay_receive() fail {
  expect _ =
    packet_lane_datum.apply_updates(
      received(),
      [
        LaneUpdate {
          mutation: ReceivePacket {
            packet: packet(1),
            acknowledgement: #"1111111111111111111111111111111111111111111111111111111111111111",
            proof_height: height(11),
          },
          siblings: [],
        },
      ],
    )
}

test packet_lane_prune_preserves_replay_floor() {
  let next = prune(received(), height(12))
  and {
    next.minimum_receive_proof_height == height(12),
    next.maximum_receive_proof_height == height(10),
    next.root == empty().root,
    next.receipts == [],
    next.acknowledgements == [],
  }
}

test packet_lane_prune_cannot_predate_receive() fail {
  expect _ = prune(received(), height(9))
}

test packet_lane_old_membership_rejected_after_prune() fail {
  let old = prune(received(), height(12))
  expect _ =
    packet_lane_datum.apply_updates(
      old,
      [
        LaneUpdate {
          mutation: ReceivePacket {
            packet: packet(1),
            acknowledgement: #"1111111111111111111111111111111111111111111111111111111111111111",
            proof_height: height(10),
          },
          siblings: [],
        },
      ],
    )
}

test packet_lane_wrong_witness_rejected() fail {
  expect _ =
    packet_lane_datum.apply_updates(
      committed(),
      [
        LaneUpdate {
          mutation: CompletePacket { packet: packet(1) },
          siblings: list.repeat([], 1),
        },
      ],
    )
}
