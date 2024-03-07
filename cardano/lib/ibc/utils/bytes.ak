use aiken/builtin
use aiken/bytearray
use aiken/list
use ibc/utils/bits

pub const max_varint_len64: Int = 10

pub type Reader {
  s: ByteArray,
  // current reading index
  i: Int,
  // index of previous rune; or < 0
  prev_rune: Int,
}

pub fn reader_len(r: Reader) -> Int {
  if r.i >= bytearray.length(r.s) {
    0
  } else {
    bytearray.length(r.s) - r.i
  }
}

pub fn new_reader(b: ByteArray) -> Reader {
  Reader { s: b, i: 0, prev_rune: -1 }
}

pub fn read_byte(r: Reader) -> (Reader, Int) {
  expect r.i < bytearray.length(r.s)
  let updated_r = Reader { s: r.s, i: r.i + 1, prev_rune: -1 }
  let b = builtin.index_bytearray(r.s, r.i)
  (updated_r, b)
}

/// read_uvarint() reads an encoded unsigned integer from r and returns it as a uint64.
pub fn read_uvarint(r: Reader) -> (Reader, Int) {
  let iterator = list.range(0, max_varint_len64 - 1)
  let (x, _s, updated_r) =
    list.reduce(
      iterator,
      (0, 0, r),
      fn(accum, i) {
        let (temp_updated_r, b) = read_byte(accum.3rd)
        // check if b < 0x80
        if b < 128 {
          expect !(i == max_varint_len64 - 1 && b > 1)
          (
            // x | uint64(b)<<s
            bits.bor(accum.1st, bits.shl(b, accum.2nd)),
            accum.2nd,
            temp_updated_r,
          )
        } else {
          (
            // x |= uint64(b&0x7f) << s
            bits.bor(accum.1st, bits.shl(bits.band(b, 127), accum.2nd)),
            accum.2nd + 7,
            temp_updated_r,
          )
        }
      },
    )

  (updated_r, x)
}

/// read_varint() reads an encoded signed integer from r and returns it as an int64.
pub fn read_varint(r: Reader) -> (Reader, Int) {
  let (updated_r, ux) = read_varint(r)
  let x = bits.shr(ux, 1)
  if bits.band(ux, 1) != 0 {
    (updated_r, bits.bnot_for_int64(x))
  } else {
    (updated_r, x)
  }
}

pub fn has_prefix(s: ByteArray, prefix: ByteArray) -> Bool {
  expect Some((start, _end)) = bytearray.index_of(s, prefix)
  start == 0
}
