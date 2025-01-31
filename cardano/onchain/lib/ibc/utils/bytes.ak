use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/primitive/bytearray.{push}
use ibc/utils/bits.{len64}
use ibc/utils/int.{Int64}

fn inner_read_uvarint(bz: ByteArray, index: Int) -> (Int, Int) {
  let cur_bz = builtin.index_bytearray(bz, index)

  let last_7_bits = cur_bz % 128

  let has_more_bytes = cur_bz >= 128

  if !has_more_bytes {
    (last_7_bits, index + 1)
  } else {
    let res = inner_read_uvarint(bz, index + 1)
    (last_7_bits + 128 * res.1st, res.2nd)
  }
}

/// read_uvarint() reads an encoded unsigned integer from r and returns it as a uint64.
pub fn read_uvarint(bz: ByteArray, pos: Int) -> (Int, Int) {
  let res = inner_read_uvarint(bz, pos)

  (res.1st, res.2nd)
}

/// read_varint() reads an encoded signed integer from r and returns it as an int64.
pub fn read_varint(r: ByteArray, pos: Int) -> (Int, Int) {
  let (ux, updated_pos) = read_uvarint(r, pos)
  let x = ux / 2
  if ux % 2 != 0 {
    (bits.bnot_for_int64(x), updated_pos)
  } else {
    (x, updated_pos)
  }
}

pub fn has_prefix(s: ByteArray, prefix: ByteArray) -> Bool {
  bytearray.take(s, bytearray.length(prefix)) == prefix
}

pub fn encode_varint(v: Int64) -> ByteArray {
  ite(
    v >= 128,
    v / 128
      |> encode_varint()
      |> push(v % 128 + 128),
    #[] |> push(v),
  )
}

pub fn sov(x: Int64) -> Int {
  x |> len64() |> add(6) |> div(7)
}
