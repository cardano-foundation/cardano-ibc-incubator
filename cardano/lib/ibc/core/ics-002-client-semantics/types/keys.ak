use aiken/bytearray
use aiken/int

pub const client_prefix = "ibc_client"

const client_prefix_with_separator = "ibc_client-"

const client_prefix_with_separator_len = 11

/// Parse sequence number of a client_id.
/// The client_id should be validated basic before.
pub fn parse_client_id_sequence(client_id: ByteArray) -> Int {
  let prefix = bytearray.take(client_id, client_prefix_with_separator_len)
  expect prefix == client_prefix_with_separator

  let str_id = bytearray.drop(client_id, client_prefix_with_separator_len)

  expect Some(id) = int.from_utf8(str_id)

  expect id >= 0

  id
}
