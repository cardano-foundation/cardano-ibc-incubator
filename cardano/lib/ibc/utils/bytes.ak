use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
  index_bytearray,
}
use aiken/bytearray.{compare, length, push, slice}
use aiken/list
use ibc/utils/bits.{band, bnot_for_int64, bor, len64, shl, shr}
use ibc/utils/int.{Int64}

pub const max_varint_len64: Int = 10

pub type Reader {
  s: ByteArray,
  // current reading index
  i: Int,
  // index of previous rune; or < 0
  prev_rune: Int,
}

pub fn reader_len(r: Reader) -> Int {
  if r.i >= length(r.s) {
    0
  } else {
    length(r.s) - r.i
  }
}

pub fn new_reader(b: ByteArray) -> Reader {
  Reader { s: b, i: 0, prev_rune: -1 }
}

pub fn read_byte(r: Reader) -> (Reader, Int) {
  if r.i < length(r.s) {
    let updated_r = Reader { s: r.s, i: r.i + 1, prev_rune: -1 }
    let b = index_bytearray(r.s, r.i)
    (updated_r, b)
  } else {
    // EOF
    (new_reader("EOF"), 0)
  }
}

/// read_uvarint() reads an encoded unsigned integer from r and returns it as a uint64.
pub fn read_uvarint(r: Reader) -> (Reader, Int) {
  let iterator = list.range(0, max_varint_len64 - 1)
  let (x, _s, updated_r) =
    list.reduce(
      iterator,
      (0, 0, r),
      fn(accum, i) {
        if accum.3rd == new_reader(#[]) {
          (accum.1st, 0, new_reader(#[]))
        } else {
          let (temp_updated_r, b) = read_byte(accum.3rd)
          expect temp_updated_r != new_reader("EOF")
          // check if b < 0x80
          if b < 128 {
            expect !(i == max_varint_len64 - 1 && b > 1)
            (
              // x | uint64(b)<<s
              bor(accum.1st, shl(b, accum.2nd)),
              0,
              new_reader(#[]),
            )
          } else {
            (
              // x |= uint64(b&0x7f) << s
              bor(accum.1st, shl(band(b, 127), accum.2nd)),
              accum.2nd + 7,
              temp_updated_r,
            )
          }
        }
      },
    )

  (updated_r, x)
}

/// read_varint() reads an encoded signed integer from r and returns it as an int64.
pub fn read_varint(r: Reader) -> (Reader, Int) {
  let (updated_r, ux) = read_uvarint(r)
  let x = shr(ux, 1)
  if band(ux, 1) != 0 {
    (updated_r, bnot_for_int64(x))
  } else {
    (updated_r, x)
  }
}

pub fn has_prefix(s: ByteArray, prefix: ByteArray) -> Bool {
  let p_length = length(prefix)
  expect length(s) >= p_length
  compare(slice(s, 0, p_length - 1), prefix) == Equal
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

//--------------------------------------Test--------------------------------------

test test_read_byte() {
  let test_bytes = #[72, 101]
  let reader_of_test_bytes = new_reader(test_bytes)
  let updated_1st_reader = Reader { s: test_bytes, i: 1, prev_rune: -1 }
  expect read_byte(reader_of_test_bytes) == (updated_1st_reader, 72)
  let updated_2nd_reader = Reader { s: test_bytes, i: 2, prev_rune: -1 }
  read_byte(updated_1st_reader) == (updated_2nd_reader, 101)
}

test test_read_byte_when_eof() {
  let test_bytes = #[72, 101]
  let current_reader = Reader { s: test_bytes, i: 2, prev_rune: -1 }
  read_byte(current_reader) == (new_reader("EOF"), 0)
}

test test_read_uvarint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  let reader_of_test_bytes = new_reader(test_bytes)
  let expected_of_test_bytes = Reader { s: #[], i: 0, prev_rune: -1 }
  read_uvarint(reader_of_test_bytes) == (expected_of_test_bytes, 1526182379905)
}

test test_read_uvarint_fail_because_eof() fail {
  let test_bytes = #[129, 131, 188, 188, 181, 144, 132, 159]
  let reader_of_test_bytes = new_reader(test_bytes)
  let expected_of_test_bytes = Reader { s: #[], i: 0, prev_rune: -1 }
  read_uvarint(reader_of_test_bytes) == (
    expected_of_test_bytes,
    17469604851810689,
  )
}

test test_read_uvarint_fail_because_overflow() fail {
  // length of test_bytes >= max_varint_len64 and it's byte at index max_varint_len64 - 1 in (1, 0x80)
  let test_bytes = #[129, 131, 188, 188, 181, 144, 132, 129, 242, 111]
  let reader_of_test_bytes = new_reader(test_bytes)
  let expected_of_test_bytes = Reader { s: #[], i: 0, prev_rune: -1 }
  read_uvarint(reader_of_test_bytes) == (
    expected_of_test_bytes,
    8215146826572956033,
  )
}

test test_read_varint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  let reader_of_test_bytes = new_reader(test_bytes)
  let expected_of_test_bytes = Reader { s: #[], i: 0, prev_rune: -1 }
  read_varint(reader_of_test_bytes) == (expected_of_test_bytes, -763091189953)
}

test test_has_prefix() {
  let test_bytes = "abcdefg"
  let prefix = "abc"
  has_prefix(test_bytes, prefix) == True
}
