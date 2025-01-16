use aiken/builtin.{if_then_else}
use aiken/math.{log, pow2}

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
  log(x, 2) + 1
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
