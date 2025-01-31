use ibc/utils/bytes.{has_prefix, read_uvarint, read_varint}

//--------------------------------------Test--------------------------------------
test test_read_uvarint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  read_uvarint(test_bytes, 0) == (1526182379905, 6)
}

test test_read_varint() {
  let test_bytes = #[129, 131, 188, 188, 181, 44, 132]
  read_varint(test_bytes, 0) == (-763091189953, 6)
}

test test_has_prefix() {
  let test_bytes = "abcdefg"
  let prefix = "abc"
  has_prefix(test_bytes, prefix)
}
