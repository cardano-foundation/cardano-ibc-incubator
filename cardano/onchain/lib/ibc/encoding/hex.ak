//// Runtime decoding of hexadecimal text carried in ByteArray values.

use aiken/builtin
use aiken/primitive/bytearray

/// Decode ASCII hex bytes into raw bytes. Accepts both letter cases and empty
/// input. Returns None for odd lengths or characters outside 0-9, A-F and a-f.
pub fn decode(str: ByteArray) -> Option<ByteArray> {
  let length = bytearray.length(str)
  if length % 2 == 0 {
    decode_hex_pairs(str, length - 2, #"")
  } else {
    None
  }
}

// ASCII values through lowercase f are represented. Zero means invalid.
// Valid hex characters (both cases) contain nibble + 1. Range-check before
// indexing so every non-ASCII or out-of-range character returns None.
const hex_decode_table =
  #"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102030405060708090a000000000000000b0c0d0e0f1000000000000000000000000000000000000000000000000000000b0c0d0e0f10"

fn decode_hex_pairs(
  str: ByteArray,
  index: Int,
  acc: ByteArray,
) -> Option<ByteArray> {
  if index < 0 {
    Some(acc)
  } else {
    let high = hex_digit(builtin.index_bytearray(str, index))
    let low = hex_digit(builtin.index_bytearray(str, index + 1))
    if high * low == 0 {
      None
    } else {
      // Reading pairs backwards and prepending preserves byte order and zeros.
      decode_hex_pairs(
        str,
        index - 2,
        builtin.cons_bytearray(16 * high + low - 17, acc),
      )
    }
  }
}

fn hex_digit(char: Int) -> Int {
  if char > 102 {
    0
  } else {
    builtin.index_bytearray(hex_decode_table, char)
  }
}
