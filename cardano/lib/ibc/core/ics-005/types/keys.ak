use aiken/bytearray
use aiken/int
use aiken/string

pub const port_prefix = "port"

const port_prefix_with_separator = "port-"

const port_prefix_with_separator_len = 5

pub fn format_port_identifier(port_number: Int) -> ByteArray {
  let port_number = string.from_int(port_number) |> string.to_bytearray()
  bytearray.concat(port_prefix_with_separator, port_number)
}

/// Parse number of a port_id.
/// The port_id should be validated basic before.
pub fn parse_port_id_number(port_id: ByteArray) -> Int {
  // "port".length = 4
  let prefix = bytearray.take(port_id, port_prefix_with_separator_len)
  expect prefix == port_prefix_with_separator

  let str_id = bytearray.drop(port_id, port_prefix_with_separator_len)

  expect Some(id) = int.from_utf8(str_id)

  expect id >= 0

  id
}
