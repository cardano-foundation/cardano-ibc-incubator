use aiken/primitive/bytearray.{from_int_big_endian, from_int_little_endian}
use ibc/utils/bits.{put_uint64, put_uint64_big_endian}

test put_uint64_succeed_1() {
  put_uint64(1) == from_int_little_endian(1, 8)
}

test put_uint64_succeed_10() {
  put_uint64(10) == from_int_little_endian(10, 8)
}

test put_uint64_succeed_11() {
  put_uint64(11) == from_int_little_endian(11, 8)
}

test put_uint64_succeed_128() {
  put_uint64(128) == from_int_little_endian(128, 8)
}

test put_uint64_succeed_250() {
  put_uint64(250) == from_int_little_endian(250, 8)
}

test put_uint64_succeed_255() {
  put_uint64(255) == from_int_little_endian(255, 8)
}

test put_uint64_big_endian_succeed_1() {
  put_uint64_big_endian(1) == from_int_big_endian(1, 8)
}

test put_uint64_big_endian_succeed_10() {
  put_uint64_big_endian(10) == from_int_big_endian(10, 8)
}

test put_uint64_big_endian_succeed_16() {
  put_uint64_big_endian(16) == from_int_big_endian(16, 8)
}

test put_uint64_big_endian_succeed_128() {
  put_uint64_big_endian(128) == from_int_big_endian(128, 8)
}

test put_uint64_big_endian_succeed_255() {
  put_uint64_big_endian(255) == from_int_big_endian(255, 8)
}
