use aiken/builtin
use aiken/collection/list
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

/// split the string in ByteArray by a separator character
pub fn split(str: ByteArray, sep: Int) -> List<ByteArray> {
  // valid 1 bytes utf-8 character
  expect 0 <= sep && sep <= 127

  let str_len = bytearray.length(str)
  if str_len == 0 {
    [""]
  } else {
    let res =
      bytearray.reduce(
        str,
        ([], 0, 0),
        fn(acc, cur_char) {
          if cur_char == sep {
            if acc.3rd == str_len - 1 {
              (
                ["", bytearray.slice(str, acc.2nd, acc.3rd - 1), ..acc.1st],
                acc.3rd + 1,
                acc.3rd + 1,
              )
            } else {
              (
                [bytearray.slice(str, acc.2nd, acc.3rd - 1), ..acc.1st],
                acc.3rd + 1,
                acc.3rd + 1,
              )
            }
          } else if acc.3rd == str_len - 1 {
            ([bytearray.slice(str, acc.2nd, acc.3rd), ..acc.1st], 0, 0)
          } else {
            (acc.1st, acc.2nd, acc.3rd + 1)
          }
        },
      )

    list.reverse(res.1st)
  }
}

pub fn hex_string_to_bytes(str: ByteArray) -> Option<ByteArray> {
  if bytearray.length(str) % 2 == 0 {
    let res =
      bytearray.foldr(
        str,
        Some((#"", None)),
        fn(cur_char, acc) {
          when acc is {
            Some(acc_val) ->
              when hex_char_to_dec(cur_char) is {
                Some(char_val) ->
                  when acc_val.2nd is {
                    Some(prev_val) -> {
                      let byte = char_val * 16 + prev_val
                      Some((bytearray.push(acc_val.1st, byte), None))
                    }
                    None -> Some((acc_val.1st, Some(char_val)))
                  }
                None -> None
              }
            None -> None
          }
        },
      )

    when res is {
      Some((bytes, _)) -> Some(bytes)
      None -> None
    }
  } else {
    None
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

fn hex_char_to_dec(char: Int) -> Option<Int> {
  if 97 <= char && char <= 102 {
    Some(char - 87)
  } else if 65 <= char && char <= 70 {
    Some(char - 55)
  } else if 48 <= char && char <= 57 {
    Some(char - 48)
  } else {
    None
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
