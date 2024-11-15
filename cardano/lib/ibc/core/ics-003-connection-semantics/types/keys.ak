use aiken/primitive/bytearray
use ibc/utils/string as string_utils

pub const connection_prefix = "connection"

const connection_prefix_with_separator = "connection-"

const connection_prefix_with_separator_len = 11

pub fn format_connection_identifier(sequence: ByteArray) -> ByteArray {
  bytearray.concat(connection_prefix_with_separator, sequence)
}

/// Parse sequence number of a connection_id.
/// The connection_id should be a valid Cardano IBC connection ID (validated with is_valid_connection_id()).
pub fn parse_connection_id_sequence(connection_id: ByteArray) -> ByteArray {
  bytearray.drop(connection_id, connection_prefix_with_separator_len)
}

pub fn is_valid_connection_id(connection_id: ByteArray) -> Bool {
  let prefix =
    bytearray.take(connection_id, connection_prefix_with_separator_len)
  if prefix == connection_prefix_with_separator {
    let str_id =
      bytearray.drop(connection_id, connection_prefix_with_separator_len)
    string_utils.is_uint_string(str_id)
  } else {
    False
  }
}
