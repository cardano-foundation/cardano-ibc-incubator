use aiken/builtin
use aiken/bytearray
use aiken/list

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

test test_trim_space() {
  expect trim_space("") == ""
  expect trim_space("             ") == ""
  expect trim_space("   abc") == "abc"
  expect trim_space("abc    ") == "abc"
  expect trim_space("    abc    ") == "abc"
  expect trim_space("    a   b  cd    ") == "a   b  cd"
  True
}

test test_split() {
  let test_cases =
    [
      // Original test case
      ("port-0/channel-99/ibc/usdt", ["port-0", "channel-99", "ibc", "usdt"]),
      // Test case with an empty string
      ("", [""]),
      // Test case with a single element
      ("element", ["element"]),
      // Test case with consecutive slashes
      ("/first//second/", ["", "first", "", "second", ""]),
      // Test case with leading and trailing slashes
      ("/start/middle/end/", ["", "start", "middle", "end", ""]),
      // Test case with spaces
      ("space separated words", ["space separated words"]),
      // Test case with special characters
      ("special@characters#test", ["special@characters#test"]),
    ]

  list.all(test_cases, fn(case) { split(case.1st, slash_char) == case.2nd })
}

test test_hex_string_to_bytes() {
  let test_cases =
    [("abcd1234", Some(#"abcd1234")), ("123x", None)]

  list.all(test_cases, fn(case) { hex_string_to_bytes(case.1st) == case.2nd })
}
