use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree

/// Unordered packet state. Channel configuration and send sequencing live in separate authenticated
/// outputs. Ordinary packet updates change only this lane's state and root.
pub type PacketLaneDatum {
  port_id: ByteArray,
  channel_id: ByteArray,
  lane: Int,
  lane_count: Int,
  version: Int,
  root: ByteArray,
  commitments: Pairs<Int, ByteArray>,
  receipts: List<Int>,
  acknowledgements: Pairs<Int, ByteArray>,
  minimum_receive_proof_height: Height,
  maximum_receive_proof_height: Height,
  balances: Pairs<ByteArray, Int>,
}

pub const max_entries_per_lane = 64

/// These describe state changes only. The packet operation validator must
/// authenticate the application callback, channel, client and remote proofs.
pub type LaneMutation {
  CommitPacket { packet: Packet }
  ReceivePacket {
    packet: Packet,
    acknowledgement: ByteArray,
    proof_height: Height,
  }
  CompletePacket { packet: Packet }
  PrunePacket { sequence: Int, proof_height: Height }
}

pub type LaneUpdate {
  mutation: LaneMutation,
  /// Sequential sparse-tree witnesses, in the mutation's fixed key order.
  siblings: List<List<ByteArray>>,
}

pub fn empty(
  port_id: ByteArray,
  channel_id: ByteArray,
  lane: Int,
  lane_count: Int,
) -> PacketLaneDatum {
  expect packet_lanes.valid_lane_count(lane_count)
  expect lane >= 0 && lane < lane_count
  PacketLaneDatum {
    port_id,
    channel_id,
    lane,
    lane_count,
    version: 0,
    root: tree.empty_hash,
    commitments: [],
    receipts: [],
    acknowledgements: [],
    minimum_receive_proof_height: height_mod.zero_height(),
    maximum_receive_proof_height: height_mod.zero_height(),
    balances: [],
  }
}

pub fn entry_count(datum: PacketLaneDatum) -> Int {
  list.length(datum.commitments) + list.length(datum.receipts) + list.length(
    datum.acknowledgements,
  )
}

pub fn mutation_sequence(mutation: LaneMutation) -> Int {
  when mutation is {
    CommitPacket { packet } -> packet.sequence
    ReceivePacket { packet, .. } -> packet.sequence
    CompletePacket { packet } -> packet.sequence
    PrunePacket { sequence, .. } -> sequence
  }
}

/// Version increments once per spent output even when a send batch inserts
/// several commitments into the same lane.
pub fn apply_updates(
  old: PacketLaneDatum,
  updates: List<LaneUpdate>,
) -> PacketLaneDatum {
  expect updates != []
  expect list.length(updates) <= max_entries_per_lane
  let updated = list.foldl(updates, old, apply_update)
  expect entry_count(updated) <= max_entries_per_lane
  PacketLaneDatum { ..updated, version: old.version + 1 }
}

fn apply_update(update: LaneUpdate, old: PacketLaneDatum) -> PacketLaneDatum {
  let sequence = mutation_sequence(update.mutation)
  expect
    packet_lanes.packet_lane(
      old.port_id,
      old.channel_id,
      sequence,
      old.lane_count,
    ) == old.lane
  let commitment_key =
    packet_keys.packet_commitment_path(old.port_id, old.channel_id, sequence)
  let receipt_key =
    packet_keys.packet_receipt_path(old.port_id, old.channel_id, sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path(
      old.port_id,
      old.channel_id,
      sequence,
    )
  when update.mutation is {
    CommitPacket { packet } -> {
      expect packet_mod.validate_basic(packet)
      expect packet.source_port == old.port_id
      expect packet.source_channel == old.channel_id
      expect !pairs.has_key(old.commitments, sequence)
      expect [siblings] = update.siblings
      let commitment = packet_mod.commit_packet(packet)
      PacketLaneDatum {
        ..old,
        root: update_root(old.root, commitment_key, "", commitment, siblings),
        commitments: pairs.insert_by_ascending_key(
          old.commitments,
          sequence,
          commitment,
          int.compare,
        ),
      }
    }
    ReceivePacket { packet, acknowledgement, proof_height } -> {
      expect packet_mod.validate_basic(packet)
      expect packet.destination_port == old.port_id
      expect packet.destination_channel == old.channel_id
      expect bytearray.length(acknowledgement) == 32
      expect height_mod.is_valid(proof_height)
      expect !height_mod.is_zero(proof_height)
      expect
        height_mod.compare(proof_height, old.minimum_receive_proof_height) != Less
      expect !list.has(old.receipts, sequence)
      expect !pairs.has_key(old.acknowledgements, sequence)
      expect [receipt_siblings, acknowledgement_siblings] = update.siblings
      let receipt_root =
        update_root(old.root, receipt_key, "", #"01", receipt_siblings)
      PacketLaneDatum {
        ..old,
        root: update_root(
          receipt_root,
          acknowledgement_key,
          "",
          acknowledgement,
          acknowledgement_siblings,
        ),
        receipts: list.sort([sequence, ..old.receipts], int.compare),
        acknowledgements: pairs.insert_by_ascending_key(
          old.acknowledgements,
          sequence,
          acknowledgement,
          int.compare,
        ),
        maximum_receive_proof_height: if height_mod.compare(
          proof_height,
          old.maximum_receive_proof_height,
        ) == Greater {
          proof_height
        } else {
          old.maximum_receive_proof_height
        },
      }
    }
    CompletePacket { packet } -> {
      expect packet_mod.validate_basic(packet)
      expect packet.source_port == old.port_id
      expect packet.source_channel == old.channel_id
      expect Some(commitment) = pairs.get_first(old.commitments, sequence)
      expect commitment == packet_mod.commit_packet(packet)
      expect [siblings] = update.siblings
      PacketLaneDatum {
        ..old,
        root: update_root(old.root, commitment_key, commitment, "", siblings),
        commitments: pairs.delete_first(old.commitments, sequence),
      }
    }
    PrunePacket { proof_height, .. } -> {
      expect height_mod.is_valid(proof_height)
      expect !height_mod.is_zero(proof_height)
      expect
        height_mod.compare(proof_height, old.minimum_receive_proof_height) != Less
      expect
        height_mod.compare(proof_height, old.maximum_receive_proof_height) != Less
      expect list.has(old.receipts, sequence)
      expect Some(acknowledgement) =
        pairs.get_first(old.acknowledgements, sequence)
      expect [receipt_siblings, acknowledgement_siblings] = update.siblings
      let receipt_root =
        update_root(old.root, receipt_key, #"01", "", receipt_siblings)
      PacketLaneDatum {
        ..old,
        root: update_root(
          receipt_root,
          acknowledgement_key,
          acknowledgement,
          "",
          acknowledgement_siblings,
        ),
        receipts: list.filter(old.receipts, fn(value) { value != sequence }),
        acknowledgements: pairs.delete_first(old.acknowledgements, sequence),
        minimum_receive_proof_height: proof_height,
      }
    }
  }
}

// Empty lanes have a unique all-zero witness. Validate it once and compute
// only the new root. Nonempty lanes retain the general two-root verification.
fn update_root(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  if old_root == tree.empty_hash {
    expect old_value == ""
    expect list.all(siblings, fn(sibling) { sibling == tree.empty_hash })
    tree.compute_root(
      key,
      tree.leaf_hash(crypto.sha2_256(key), tree.value_hash(new_value)),
      siblings,
    )
  } else {
    tree.apply_update(old_root, key, old_value, new_value, siblings)
  }
}
