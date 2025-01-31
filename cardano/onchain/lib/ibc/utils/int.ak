use aiken/primitive/string

pub const max_uint64 = 18446744073709551616

pub const max_uint32 = 4294967296

pub type Int32 =
  Int

pub type Int64 =
  Int

pub type Uint64 =
  Int

pub type Uint8 =
  Int

pub fn to_string(x: Int) -> ByteArray {
  string.from_int(x) |> string.to_bytearray()
}

pub fn uint64(x: Int) -> Int {
  x % max_uint64
}

pub fn uint32(x: Int) -> Int {
  x % max_uint32
}
