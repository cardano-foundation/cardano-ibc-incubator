use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/collection/list
use aiken/primitive/bytearray.{concat, from_int_little_endian, length, push}
use ibc/utils/bits
use ibc/utils/int.{Int64, uint64}

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

const varint_1_byte_limit = 128

const varint_2_byte_limit = 16384

const varint_3_byte_limit = 2097152

const varint_4_byte_limit = 268435456

const varint_5_byte_limit = 34359738368

const varint_6_byte_limit = 4398046511104

const varint_7_byte_limit = 562949953421312

const varint_8_byte_limit = 72057594037927936

const varint_9_byte_limit = 9223372036854775808

fn continuation_byte(v: Int64) -> Int {
  v % 128 + 128
}

fn encode_varint_1(v: Int64) -> ByteArray {
  push(#[], v)
}

fn encode_varint_2(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_1()
    |> push(continuation_byte(v))
}

fn encode_varint_3(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_2()
    |> push(continuation_byte(v))
}

fn encode_varint_4(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_3()
    |> push(continuation_byte(v))
}

fn encode_varint_5(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_4()
    |> push(continuation_byte(v))
}

fn encode_varint_6(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_5()
    |> push(continuation_byte(v))
}

fn encode_varint_7(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_6()
    |> push(continuation_byte(v))
}

fn encode_varint_8(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_7()
    |> push(continuation_byte(v))
}

fn encode_varint_9(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_8()
    |> push(continuation_byte(v))
}

fn encode_varint_10(v: Int64) -> ByteArray {
  v / 128
    |> encode_varint_9()
    |> push(continuation_byte(v))
}

pub fn encode_varint(v: Int64) -> ByteArray {
  if v < varint_1_byte_limit {
    encode_varint_1(v)
  } else if v < varint_2_byte_limit {
    encode_varint_2(v)
  } else if v < varint_3_byte_limit {
    encode_varint_3(v)
  } else if v < varint_4_byte_limit {
    encode_varint_4(v)
  } else if v < varint_5_byte_limit {
    encode_varint_5(v)
  } else if v < varint_6_byte_limit {
    encode_varint_6(v)
  } else if v < varint_7_byte_limit {
    encode_varint_7(v)
  } else if v < varint_8_byte_limit {
    encode_varint_8(v)
  } else if v < varint_9_byte_limit {
    encode_varint_9(v)
  } else {
    encode_varint_10(v)
  }
}

pub fn encode_length_varint(v: Int64) -> ByteArray {
  if v < varint_1_byte_limit {
    encode_varint_1(v)
  } else {
    // implies x < 16384 always
    encode_varint_2(v)
  }
}

pub fn sov(x: Int64) -> Int {
  if x < 0 {
    10
  } else if x < varint_1_byte_limit {
    1
  } else if x < varint_2_byte_limit {
    2
  } else if x < varint_3_byte_limit {
    3
  } else if x < varint_4_byte_limit {
    4
  } else if x < varint_5_byte_limit {
    5
  } else if x < varint_6_byte_limit {
    6
  } else if x < varint_7_byte_limit {
    7
  } else if x < varint_8_byte_limit {
    8
  } else if x < varint_9_byte_limit {
    9
  } else {
    10
  }
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
  if length == 0 {
    (size, concat(bz1, bz2))
  } else {
    (size + sov_length(length) + length + 1, concat(bz1, bz2))
  }
}

pub fn nest_record(a: (Int, ByteArray), identifier: Int) -> (Int, ByteArray) {
  let (size, bz1) = a
  let bz2 =
    size
      |> encode_length_varint()
      |> concat(bz1)
      |> push(identifier)
  (sov_length(size) + size + 1, bz2)
}

pub fn add_and_concat(
  a: (Int, ByteArray),
  b: (Int, ByteArray),
) -> (Int, ByteArray) {
  let (size1, bz1) = a
  let (size2, bz2) = b
  (size1 + size2, concat(bz1, bz2))
}

// Test for int = 0
pub fn encode_int(int: Int, identifier: Int) -> (Int, ByteArray) {
  when int is {
    0 -> (0, #"")
    _ -> {
      let l = uint64(int) |> sov() |> add(1)
      let hash = uint64(int) |> encode_varint() |> push(identifier)
      (l, hash)
    }
  }
}

// Test for int = 0
pub fn encode_int_length(int: Int, identifier: Int) -> (Int, ByteArray) {
  when int is {
    0 -> (0, #"")
    _ -> {
      let l = sov_length(int) + 1
      let hash = encode_length_varint(int) |> push(identifier)
      (l, hash)
    }
  }
}

pub fn encode_int_little_endian(
  int: Int,
  identifier: Int,
  constant_lenght: Int,
) -> (Int, ByteArray) {
  when int is {
    0 -> (0, #"")
    _ -> {
      let l = ite(int == 0, 0, constant_lenght)
      let hash = int |> from_int_little_endian(8) |> push(identifier)
      (l, hash)
    }
  }
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

pub fn reduce(
  items: List<a>,
  f: fn(a) -> (Int, ByteArray),
  identifier: Int,
) -> (Int, ByteArray) {
  if list.is_empty(items) {
    (0, #"")
  } else {
    let (l, bz) =
      list.reduce(
        items,
        (0, #""),
        fn(acc: (Int, ByteArray), list_iteam: a) -> (Int, ByteArray) {
          let (size, bz1) = acc
          let (l, bz2) = f(list_iteam)
          let something = encode_length_varint(l) |> concat(bz2)
          (size + sov(l) + l + 1, concat(bz1, something))
        },
      )
    (l, push(bz, identifier))
  }
}
