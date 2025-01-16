pub fn ceil_divide_uinteger(numerator: Int, denominator: Int) -> Int {
  expect numerator >= 0 && denominator > 0
  let temp = numerator / denominator
  if temp * denominator == numerator {
    temp
  } else {
    temp + 1
  }
}

test test_ceil_divide_uinteger() {
  expect ceil_divide_uinteger(28, 14) == 2
  ceil_divide_uinteger(40, 14) == 3
}
