use aiken/bytearray
use aiken/int
use aiken/string

pub const connection_prefix = "connection"

const connection_prefix_with_separator = "connection-"

const connection_prefix_with_separator_len = 11

pub fn format_connection_identifier(sequence: Int) -> ByteArray {
  let sequence = string.from_int(sequence) |> string.to_bytearray()
  bytearray.concat(connection_prefix_with_separator, sequence)
}

/// Parse sequence number of a connection_id.
/// The connection_id should be validated basic before.
pub fn parse_connection_id_sequence(connection_id: ByteArray) -> Int {
  let prefix =
    bytearray.take(connection_id, connection_prefix_with_separator_len)
  expect prefix == connection_prefix_with_separator

  let str_id =
    bytearray.drop(connection_id, connection_prefix_with_separator_len)

  expect Some(id) = int.from_utf8(str_id)

  id
}
