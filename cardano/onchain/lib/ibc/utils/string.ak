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
  let len = bytearray.length(str)
  if len % 2 == 0 {
    do_hex_string_to_bytes(Some, None, str, len, 0)
  } else {
    None
  }
}

fn do_hex_string_to_bytes(
  ok: fn(ByteArray) -> a,
  ko: a,
  str: ByteArray,
  len: Int,
  i: Int,
) -> a {
  if i >= len {
    ok("")
  } else {
    let msb <-
      decode_hex_digit(_, ko, bytearray.at(str, i))
    let lsb <-
      decode_hex_digit(_, ko, bytearray.at(str, i + 1))
    let byte = msb * 16 + lsb
    do_hex_string_to_bytes(
      fn(accum) { ok(bytearray.push(accum, byte)) },
      ko,
      str,
      len,
      i + 2,
    )
  }
}

// NOTE: The constant is evaluated at compile-time, so constructing the lookup table is cheap.
const hex_lookup_table =
  "------------------------------------------------"
    |> bytearray.concat(#[0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    |> bytearray.concat("-------")
    |> bytearray.concat(#[10, 11, 12, 13, 14, 15])
    |> bytearray.concat("--------------------------")
    |> bytearray.concat(#[10, 11, 12, 13, 14, 15])

fn decode_hex_digit(ok: fn(Int) -> a, ko: a, char: Int) -> a {
  if char > 102 {
    ko
  } else {
    let digit = bytearray.at(hex_lookup_table, char)
    if digit == 0x2d {
      ko
    } else {
      ok(digit)
    }
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
