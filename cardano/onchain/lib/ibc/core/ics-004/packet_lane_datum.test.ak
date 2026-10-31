use aiken/builtin
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_lane_datum.{
  CommitPacket, CompletePacket, LaneMutation, LaneUpdate, PacketLaneDatum,
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
  packet_lane_datum.empty("transfer", "channel-0", 1, 16)
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
  let receipt = packet_keys.packet_receipt_path("transfer", "channel-0", 1)
  let ack = packet_keys.packet_acknowledgement_path("transfer", "channel-0", 1)
  let entries =
    [
      Pair(receipt, #"01"),
      Pair(
        ack,
        #"1111111111111111111111111111111111111111111111111111111111111111",
      ),
    ]
  let witnesses: List<List<ByteArray>> =
    [sparse_tree.siblings(entries, receipt), sparse_tree.siblings(entries, ack)]
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
          siblings: witnesses,
        },
      ],
    )
}

test packet_lane_receive_keeps_only_the_root() {
  let datum = received()
  and {
    datum.root != empty().root,
    datum.receipts == [],
    datum.acknowledgements == [],
    packet_lane_datum.entry_count(datum) == 0,
  }
}

test packet_lane_wrong_witness_rejected() fail {
  let witnesses: List<List<ByteArray>> = list.repeat([], 1)
  expect _ =
    packet_lane_datum.apply_updates(
      committed(),
      [
        LaneUpdate {
          mutation: CompletePacket { packet: packet(1) },
          siblings: witnesses,
        },
      ],
    )
}

test packet_lane_opaque_witness_must_be_a_list_of_hash_lists() fail {
  expect _ =
    packet_lane_datum.apply_updates(
      empty(),
      [
        LaneUpdate {
          mutation: CommitPacket { packet: packet(1) },
          siblings: 42,
        },
      ],
    )
}

test packet_lane_opaque_witness_rejects_non_bytes_siblings() fail {
  expect _ =
    packet_lane_datum.apply_updates(
      empty(),
      [
        LaneUpdate {
          mutation: CommitPacket { packet: packet(1) },
          siblings: [list.repeat(0, 64)],
        },
      ],
    )
}

test packet_lane_removed_prune_mutation_is_rejected() fail {
  let sequence: Data = 1
  let proof_height: Data = height(12)
  let raw = builtin.constr_data(3, [sequence, proof_height])
  expect mutation: LaneMutation = raw
  packet_lane_datum.mutation_sequence(mutation) == 1
}

test packet_lane_legacy_receipts_require_explicit_migration() fail {
  let key = packet_keys.packet_commitment_path("transfer", "channel-0", 1)
  expect _ =
    packet_lane_datum.apply_updates(
      PacketLaneDatum { ..committed(), receipts: [1] },
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
}
