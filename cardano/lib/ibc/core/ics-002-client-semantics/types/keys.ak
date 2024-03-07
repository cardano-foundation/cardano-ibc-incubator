use aiken/bytearray
use ibc/utils/string

pub const client_prefix = "ibc_client"

/// Parse sequence number of a client_id.
/// The client_id should be validated basic before.
pub fn parse_client_id_sequence(client_id: ByteArray) -> Int {
  expect Some((separate_idx, _)) = bytearray.index_of(client_id, "-")

  let prefix = bytearray.take(client_id, separate_idx)
  expect prefix == client_prefix

  let str_id = bytearray.drop(client_id, separate_idx + 1)

  expect Some(id) = string.parse_uint(str_id)

  id
}
