use aiken/primitive/bytearray
use ibc/utils/text_bytes

// State-token namespace; separate from the registered IBC client type.
pub const client_prefix = "ibc_client"

fn last_separator(identifier: ByteArray, index: Int) -> Int {
  if index < 0 {
    -1
  } else if bytearray.at(identifier, index) == 45 {
    index
  } else {
    last_separator(identifier, index - 1)
  }
}

/// The final component is the sequence; client types may contain hyphens.
/// The registry separately authenticates the complete type prefix.
pub fn parse_client_id_sequence(client_id: ByteArray) -> ByteArray {
  let separator = last_separator(client_id, bytearray.length(client_id) - 1)
  expect separator > 0
  let sequence = bytearray.drop(client_id, separator + 1)
  expect text_bytes.is_canonical_unsigned_decimal(sequence)
  sequence
}

pub fn is_valid_client_id(client_id: ByteArray) -> Bool {
  let separator = last_separator(client_id, bytearray.length(client_id) - 1)
  and {
    separator > 0,
    text_bytes.is_canonical_unsigned_decimal(
      bytearray.drop(client_id, separator + 1),
    ),
  }
}
