use aiken/builtin.{if_then_else, index_bytearray}
use aiken/bytearray.{push}
use aiken/math.{pow2}
use ibc/utils/bits_table.{len8tab}

pub type BitwiseOperator {
  AND
  OR
  XOR
}

pub fn band(a: Int, b: Int) -> Int {
  recursive_bitwise_operation(a, b, 1, AND)
}

pub fn bor(a: Int, b: Int) -> Int {
  recursive_bitwise_operation(a, b, 1, OR)
}

pub fn bnot_for_int64(a: Int) -> Int {
  -a - 1
}

pub fn bxor(a: Int, b: Int) -> Int {
  recursive_bitwise_operation(a, b, 1, XOR)
}

pub fn shl(a: Int, shift: Int) -> Int {
  a * pow2(shift)
}

pub fn shr(a: Int, shift: Int) -> Int {
  a / pow2(shift)
}

pub fn len(x: Int) -> Int {
  len64(x)
}

pub fn len64(x: Int) -> Int {
  if x >= ( 1 |> shl(32) ) {
    let x = x |> shr(32)
    32 + len64(x)
  } else if x >= ( 1 |> shl(16) ) {
    let x = x |> shr(16)
    16 + len64(x)
  } else if x >= ( 1 |> shl(8) ) {
    let x = x |> shr(8)
    8 + len64(x)
  } else {
    index_bytearray(len8tab, x)
  }
}

pub fn put_uint64(v: Int) -> ByteArray {
  #[]
    |> push(v |> shr(56))
    |> push(v |> shr(48))
    |> push(v |> shr(40))
    |> push(v |> shr(32))
    |> push(v |> shr(24))
    |> push(v |> shr(16))
    |> push(v |> shr(8))
    |> push(v)
}

pub fn put_uint64_big_endian(v: Int) -> ByteArray {
  #[]
    |> push(v)
    |> push(v |> shr(8))
    |> push(v |> shr(16))
    |> push(v |> shr(24))
    |> push(v |> shr(32))
    |> push(v |> shr(40))
    |> push(v |> shr(48))
    |> push(v |> shr(56))
}

fn recursive_bitwise_operation(
  a: Int,
  b: Int,
  multiplier: Int,
  operator: BitwiseOperator,
) -> Int {
  let lsb_a = a % 2
  let lsb_b = b % 2
  when operator is {
    AND ->
      if a == 0 || b == 0 {
        0
      } else {
        let result = if_then_else(lsb_a == 1 && lsb_b == 1, multiplier, 0)
        result + recursive_bitwise_operation(
          a / 2,
          b / 2,
          multiplier * 2,
          operator,
        )
      }
    OR ->
      if a == 0 && b == 0 {
        0
      } else {
        let result = if_then_else(lsb_a == 1 || lsb_b == 1, multiplier, 0)
        result + recursive_bitwise_operation(
          a / 2,
          b / 2,
          multiplier * 2,
          operator,
        )
      }
    XOR ->
      if a == 0 && b == 0 {
        0
      } else {
        if_then_else(
          lsb_a == 0 && lsb_b == 1 || lsb_a == 1 && lsb_b == 0,
          multiplier,
          0,
        ) + recursive_bitwise_operation(a / 2, b / 2, multiplier * 2, operator)
      }
  }
}

test test_bor() {
  bor(100, 200) == 236
}

test test_band() {
  band(100, 200) == 64
}

test test_bnot_for_int64() {
  bnot_for_int64(46) == -47
}

test test_bxor() {
  bxor(100, 122) == 30
}
