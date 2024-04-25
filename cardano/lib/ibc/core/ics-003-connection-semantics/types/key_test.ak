use ibc/core/ics_003_connection_semantics/types/keys

test test_format_connection_identifier() {
  let mock_sequence = #"313030"
  keys.format_connection_identifier(mock_sequence) == "connection-100"
}

test test_parse_connection_id_sequence_succeed() {
  let mock_connection_id = "connection-100"
  keys.parse_connection_id_sequence(mock_connection_id) == 100
}

test test_parse_connection_id_sequence_fail_when_format_invalid() fail {
  let mock_connection_id = "connection100"
  keys.parse_connection_id_sequence(mock_connection_id) == 100
}

test test_parse_connection_id_sequence_fail_when_format_invalid_2() fail {
  let mock_connection_id = "con-100"
  keys.parse_connection_id_sequence(mock_connection_id) == 100
}

test test_parse_connection_id_sequence_fail_when_format_invalid_3() fail {
  let mock_connection_id = "CONNECTION-100"
  keys.parse_connection_id_sequence(mock_connection_id) == 100
}

test test_parse_connection_id_sequence_fail_when_format_invalid_4() fail {
  let mock_connection_id = "connection-100a"
  keys.parse_connection_id_sequence(mock_connection_id) == 100
}
