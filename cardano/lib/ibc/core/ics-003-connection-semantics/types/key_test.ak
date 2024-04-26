use ibc/core/ics_003_connection_semantics/types/keys

test test_format_connection_identifier() {
  let mock_sequence = #"313030"
  keys.format_connection_identifier(mock_sequence) == "connection-100"
}

test test_parse_connection_id_sequence_succeed() {
  let mock_connection_id = "connection-100"
  keys.parse_connection_id_sequence(mock_connection_id) == "100"
}
