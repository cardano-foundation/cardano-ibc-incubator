use aiken/bytearray
use aiken/int
use aiken/string

pub const connection_prefix = "connection"

pub fn format_connection_identifier(sequence: Int) -> ByteArray {
  let sequence = string.from_int(sequence) |> string.to_bytearray()
  bytearray.concat(connection_prefix, "-") |> bytearray.concat(sequence)
}

/// Parse sequence number of a connection_id.
/// The connection_id should be validated basic before.
pub fn parse_connection_id_sequence(connection_id: ByteArray) -> Int {
  expect Some((separate_idx, _)) = bytearray.index_of(connection_id, "-")

  let prefix = bytearray.take(connection_id, separate_idx)
  expect prefix == connection_prefix

  let str_id = bytearray.drop(connection_id, separate_idx + 1)

  expect Some(id) = int.from_utf8(str_id)

  id
}
