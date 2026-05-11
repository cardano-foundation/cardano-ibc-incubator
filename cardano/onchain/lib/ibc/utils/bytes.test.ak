use ibc/utils/bytes.{
  encode_int, encode_int_little_endian, encode_varint, has_prefix, read_uvarint,
  read_varint, sov,
}

//--------------------------------------Test--------------------------------------
test test_read_uvarint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  read_uvarint(test_bytes, 0) == (1526182379905, 6)
}

test test_read_varint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  read_varint(test_bytes, 0) == (-763091189953, 6)
}

test test_encode_varint_boundaries() {
  let max_uint64 = 18446744073709551615
  and {
    encode_varint(0) == #[0],
    encode_varint(127) == #[127],
    encode_varint(128) == #[128, 1],
    encode_varint(300) == #[172, 2],
    encode_varint(16384) == #[128, 128, 1],
    encode_varint(max_uint64) == #[
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      1,
    ],
    read_uvarint(encode_varint(max_uint64), 0) == (max_uint64, 10),
  }
}

test test_sov_boundaries() {
  and {
    sov(0) == 1,
    sov(127) == 1,
    sov(128) == 2,
    sov(16383) == 2,
    sov(16384) == 3,
    sov(9223372036854775807) == 9,
    sov(9223372036854775808) == 10,
    sov(18446744073709551615) == 10,
  }
}

test test_has_prefix() {
  let test_bytes = "abcdefg"
  let prefix = "abc"
  has_prefix(test_bytes, prefix)
}

test test_encode_int_zero() {
  let (l, bytes) = encode_int(0, 8)
  and {
    l == 0,
    bytes == #"",
  }
}

test test_encode_int_little_endian() {
  let (l, bytes) = encode_int_little_endian(0, 8, 9)
  l == 0 && bytes == #""
}
