use aiken/collection/list
use ibc/encoding/hex

test hex_decode_examples() {
  let test_cases = [("abcd1234", Some(#"abcd1234")), ("123x", None)]
  list.all(test_cases, fn(case) { hex.decode(case.1st) == case.2nd })
}
