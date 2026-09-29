//// ByteArray helpers for protocol text. These operations use ASCII delimiters
//// and digits without treating input as Aiken String values.

use aiken/builtin
use aiken/primitive/bytearray
use aiken/primitive/string

/// ASCII byte value of `/`.
pub const ascii_slash = 47

/// Remove only leading and trailing ASCII spaces (0x20).
pub fn trim_ascii_spaces(str: ByteArray) -> ByteArray {
  str |> trim_left() |> trim_right()
}

fn trim_left(str: ByteArray) -> ByteArray {
  if str == "" {
    ""
  } else {
    let first_byte = builtin.index_bytearray(str, 0)
    when first_byte is {
      0x20 -> trim_left(bytearray.drop(str, 1))
      _ -> str
    }
  }
}

fn trim_right(str: ByteArray) -> ByteArray {
  if str == "" {
    ""
  } else {
    let len = bytearray.length(str)
    let last_byte = builtin.index_bytearray(str, len - 1)
    when last_byte is {
      0x20 -> trim_right(bytearray.take(str, len - 1))
      _ -> str
    }
  }
}

/// Split on one ASCII byte (0-127), preserving empty segments.
pub fn split_on_ascii_byte(str: ByteArray, sep: Int) -> List<ByteArray> {
  expect 0 <= sep && sep <= 127
  do_split(str, sep, bytearray.length(str), 0, identity)
}

fn do_split(
  str: ByteArray,
  sep: Int,
  len: Int,
  i: Int,
  return: fn(List<ByteArray>) -> a,
) -> a {
  if i >= len {
    return([str])
  } else {
    if bytearray.at(str, i) == sep {
      do_split(
        bytearray.drop(str, i + 1),
        sep,
        len - i - 1,
        0,
        fn(result) {
          return(
            [
              if i > 0 {
                bytearray.slice(str, 0, i - 1)
              } else {
                ""
              },
              ..result
            ],
          )
        },
      )
    } else {
      do_split(str, sep, len, i + 1, return)
    }
  }
}

/// Encode an integer as decimal text bytes using the standard library.
pub fn int_to_decimal_bytes(n: Int) -> ByteArray {
  string.from_int(n) |> string.to_bytearray()
}

/// Accept `0` or a nonempty sequence of ASCII digits without leading zeros.
pub fn is_canonical_unsigned_decimal(n: ByteArray) -> Bool {
  if bytearray.length(n) == 0 {
    False
  } else if n == "0" {
    True
  } else if builtin.index_bytearray(n, 0) == 0x30 {
    False
  } else {
    bytearray.foldr(
      n,
      True,
      fn(byte, acc) { acc && byte >= 0x30 && byte <= 0x39 },
    )
  }
}

fn only_spaces(str: ByteArray, length: Int, i: Int) -> Bool {
  if i >= length {
    True
  } else {
    when builtin.index_bytearray(str, i) is {
      0x20 -> only_spaces(str, length, i + 1)
      _ -> False
    }
  }
}

/// Accept empty input or bytes consisting entirely of ASCII spaces (0x20).
pub fn is_empty_or_ascii_spaces(str: ByteArray) -> Bool {
  only_spaces(str, bytearray.length(str), 0)
}
