use aiken/collection/list
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/types/packet.{Packet}

pub type SendSequencerDatum {
  port_id: ByteArray,
  channel_id: ByteArray,
  version: Int,
  next_sequence_send: Int,
}

pub const max_send_batch_size = 5

/// The transaction validator also binds every packet to its funded intent,
/// application callback and the exact lane commitment update. Acknowledgement
/// state is deliberately not a dependency of the channel send sequence.
pub fn advance(
  old: SendSequencerDatum,
  packets: List<Packet>,
) -> SendSequencerDatum {
  let count = list.length(packets)
  expect count > 0 && count <= max_send_batch_size
  expect old.next_sequence_send > 0
  // Keep the successor representable as the IBC uint64 counter.
  expect old.next_sequence_send + count <= packet_lanes.max_packet_sequence
  let next_sequence_send =
    list.foldl(
      packets,
      old.next_sequence_send,
      fn(packet, expected_sequence) {
        expect packet.source_port == old.port_id
        expect packet.source_channel == old.channel_id
        expect packet.sequence == expected_sequence
        expected_sequence + 1
      },
    )
  SendSequencerDatum { ..old, version: old.version + 1, next_sequence_send }
}
