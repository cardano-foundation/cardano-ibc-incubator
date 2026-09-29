use aiken/builtin
use aiken/primitive/bytearray
use aiken/primitive/string

pub const slash_char = 47

// slash character in int

pub fn trim_space(str: ByteArray) -> ByteArray {
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

pub fn split(str: ByteArray, sep: Int) -> List<ByteArray> {
  // valid 1 bytes utf-8 character
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

pub fn hex_string_to_bytes(str: ByteArray) -> Option<ByteArray> {
  let length = bytearray.length(str)
  if length % 2 == 0 {
    decode_hex_pairs(str, length - 2, #"")
  } else {
    None
  }
}

// ASCII values through lowercase f are represented. Zero means invalid;
// valid hex characters (both cases) contain nibble + 1. Range-check before
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

pub fn int_to_string(n: Int) -> ByteArray {
  string.from_int(n) |> string.to_bytearray()
}

/// Custom function for checking whether a string in ids is a valid
/// unsigned integer
pub fn is_uint_string(n: ByteArray) -> Bool {
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

pub fn is_only_space(str: ByteArray) -> Bool {
  only_spaces(str, bytearray.length(str), 0)
}
