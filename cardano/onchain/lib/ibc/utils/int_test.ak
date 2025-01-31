use ibc/utils/int.{to_string, uint64}

test uint64_0() {
  uint64(-12345678912345678) == 18434398394797205938
}

test uint64_1() {
  uint64(1234567891234567812345678912345678) == 5874277186040550990
}

test test_to_string() {
  expect to_string(12) == #"3132"
  to_string(1112) == #"31313132"
}
