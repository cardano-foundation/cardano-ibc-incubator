use aiken/bytearray
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/utils/int

pub const key_packet_commitment_prefix = "commitments"

pub const key_packet_ack_prefix = "acks"

pub const key_packet_receipt_prefix = "receipts"

pub const key_sequence_prefix = "sequences"

pub const key_next_seq_recv_prefix = "nextSequenceRecv"

pub fn packet_commitment_path(
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
) -> ByteArray {
  packet_commitment_prefix_path(port_id, channel_id)
    |> bytearray.concat("/")
    |> bytearray.concat(int.to_string(sequence))
}

pub fn packet_commitment_prefix_path(
  port_id: ByteArray,
  channel_id: ByteArray,
) -> ByteArray {
  key_packet_commitment_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_keys.channel_path_for_packet(port_id, channel_id))
    |> bytearray.concat("/")
    |> bytearray.concat(key_sequence_prefix)
}

pub fn packet_acknowledgement_path(
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
) -> ByteArray {
  packet_acknowledgement_prefix_path(port_id, channel_id)
    |> bytearray.concat("/")
    |> bytearray.concat(int.to_string(sequence))
}

pub fn packet_acknowledgement_prefix_path(
  port_id: ByteArray,
  channel_id: ByteArray,
) -> ByteArray {
  key_packet_ack_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_keys.channel_path_for_packet(port_id, channel_id))
    |> bytearray.concat("/")
    |> bytearray.concat(key_sequence_prefix)
}

pub fn packet_receipt_path(
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
) -> ByteArray {
  key_packet_receipt_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_keys.channel_path_for_packet(port_id, channel_id))
    |> bytearray.concat("/")
    |> bytearray.concat(sequence_path(sequence))
}

pub fn next_sequence_recv_path(
  port_id: ByteArray,
  channel_id: ByteArray,
) -> ByteArray {
  key_next_seq_recv_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_keys.channel_path_for_packet(port_id, channel_id))
}

fn sequence_path(sequence: Int) -> ByteArray {
  key_sequence_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(int.to_string(sequence))
}

test test_packet_commitment_path() {
  packet_commitment_path("transfer", "channel-00", 1112) == "commitments/ports/transfer/channels/channel-00/sequences/1112"
}

test test_packet_acknowledgement_path() {
  packet_acknowledgement_path("transfer", "channel-00", 1112) == "acks/ports/transfer/channels/channel-00/sequences/1112"
}

test test_packet_receipt_path() {
  packet_receipt_path("transfer", "channel-00", 1112) == "receipts/ports/transfer/channels/channel-00/sequences/1112"
}

test test_next_sequence_recv_path() {
  next_sequence_recv_path("transfer", "channel-00") == "nextSequenceRecv/ports/transfer/channels/channel-00"
}