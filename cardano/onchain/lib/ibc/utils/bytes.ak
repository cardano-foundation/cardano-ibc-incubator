use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/primitive/bytearray.{concat, length, push}
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

pub fn encode_length_varint(v: Int64) -> ByteArray {
  if v < 128 {
    push(#[], v)
  } else {
    // implies x < 16384 always
    push(#[], v / 128)
      |> push(v % 128 + 128)
  }
}

pub fn sov(x: Int64) -> Int {
  x |> len64() |> add(6) |> div(7)
}

pub fn sov_length(x: Int64) -> Int {
  if x < 128 {
    1
  } else {
    // implies x < 16384 always
    2
  }
}

pub fn is_empty_or_size(h: ByteArray, size: Int) -> Bool {
  let len = bytearray.length(h)
  len == 0 || len == size
}

pub fn size_and_concat(
  a: (Int, ByteArray),
  b: (Int, ByteArray),
) -> (Int, ByteArray) {
  let (size, bz1) = a
  let (length, bz2) = b
  (size + sov_length(length) + length + 1, concat(bz1, bz2))
}

pub fn add_and_concat(
  a: (Int, ByteArray),
  b: (Int, ByteArray),
) -> (Int, ByteArray) {
  let (size1, bz1) = a
  let (size2, bz2) = b
  (size1 + size2, concat(bz1, bz2))
}

pub fn encode_bytearray(bz1: ByteArray, identifier: Int) -> (Int, ByteArray) {
  let l = length(bz1)
  ite(
    l == 0,
    (0, #[]),
    {
      let bz2 = l |> encode_length_varint() |> concat(bz1) |> push(identifier)
      (l, bz2)
    },
  )
}
