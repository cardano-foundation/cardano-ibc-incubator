use aiken/bytearray
use aiken/int
use aiken/string

pub const port_prefix = "port"

pub fn format_port_identifier(port_number: Int) -> ByteArray {
  let port_number = string.from_int(port_number) |> string.to_bytearray()
  bytearray.concat(port_prefix, "-") |> bytearray.concat(port_number)
}

/// Parse number of a port_id.
/// The port_id should be validated basic before.
pub fn parse_port_id_number(port_id: ByteArray) -> Int {
  expect Some((separate_idx, _)) = bytearray.index_of(port_id, "-")

  let prefix = bytearray.take(port_id, separate_idx)
  expect prefix == port_prefix

  let str_id = bytearray.drop(port_id, separate_idx + 1)

  expect Some(id) = int.from_utf8(str_id)

  expect id >= 0

  id
}
