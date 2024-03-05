use aiken/builtin
use aiken/bytearray

pub fn trim_space(str: ByteArray) -> ByteArray {
  str |> trim_left() |> trim_right()
}

pub fn trim_left(str: ByteArray) -> ByteArray {
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

pub fn trim_right(str: ByteArray) -> ByteArray {
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

test test_trim_space() {
  expect trim_space("") == ""
  expect trim_space("             ") == ""
  expect trim_space("   abc") == "abc"
  expect trim_space("abc    ") == "abc"
  expect trim_space("    abc    ") == "abc"
  expect trim_space("    a   b  cd    ") == "a   b  cd"
  True
}
