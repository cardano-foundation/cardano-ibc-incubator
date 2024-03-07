use aiken/bytearray
use aiken/int
use aiken/string

pub const channel_prefix = "channel"

pub fn format_channel_identifier(sequence: Int) -> ByteArray {
  let sequence = string.from_int(sequence) |> string.to_bytearray()
  bytearray.concat(channel_prefix, "-") |> bytearray.concat(sequence)
}

/// Parse sequence number of a channel_id.
/// The channel_id should be validated basic before.
pub fn parse_channel_id_sequence(channel_id: ByteArray) -> Int {
  expect Some((separate_idx, _)) = bytearray.index_of(channel_id, "-")

  let prefix = bytearray.take(channel_id, separate_idx)
  expect prefix == channel_prefix

  let str_id = bytearray.drop(channel_id, separate_idx + 1)

  expect Some(id) = int.from_utf8(str_id)

  expect id >= 0

  id
}
