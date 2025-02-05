use aiken/collection/list
use ibc/core/ics_003_connection_semantics/types/keys as keys_mod

test test_format_connection_identifier() {
  let mock_sequence = #"313030"
  keys_mod.format_connection_identifier(mock_sequence) == "connection-100"
}

test test_parse_connection_id_sequence_succeed() {
  let mock_connection_id = "connection-100"
  keys_mod.parse_connection_id_sequence(mock_connection_id) == "100"
}

test test_is_valid_connection_id() {
  let test_cases =
    [
      ("connection-123", True),
      // invalid prefix
      ("client-123", False),
      // invalid sequence
      ("connection-1x3", False),
    ]

  list.all(
    test_cases,
    fn(case) { keys_mod.is_valid_connection_id(case.1st) == case.2nd },
  )
}
