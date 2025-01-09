use aiken/primitive/bytearray
use aiken/primitive/string
use ibc/utils/string as string_utils

pub const port_prefix = "port"

const port_prefix_with_separator = "port-"

const port_prefix_with_separator_len = 5

pub fn format_port_identifier(port_number: Int) -> ByteArray {
  let port_number = string.from_int(port_number) |> string.to_bytearray()
  bytearray.concat(port_prefix_with_separator, port_number)
}

/// Parse number of a port_id.
/// The port_id should be a valid Cardano IBC port ID (validated with is_valid_port_id()).
pub fn parse_port_id_number(port_id: ByteArray) -> ByteArray {
  bytearray.drop(port_id, port_prefix_with_separator_len)
}

pub fn is_valid_port_id(port_id: ByteArray) -> Bool {
  let prefix = bytearray.take(port_id, port_prefix_with_separator_len)
  if prefix == port_prefix_with_separator {
    let str_id = bytearray.drop(port_id, port_prefix_with_separator_len)
    string_utils.is_uint_string(str_id)
  } else {
    False
  }
}
