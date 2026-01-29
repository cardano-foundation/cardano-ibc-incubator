use aiken/collection/list
use ibc/core/ics_005/types/keys as keys_mod

//============================format_port_identifier====================================

test format_port_identifier_succeed() {
  keys_mod.format_port_identifier(98) == "port-98"
}

test format_port_identifier_fail_with_negative_sequence() fail {
  keys_mod.format_port_identifier(-1) == ""
}

//============================parse_port_id_number====================================
test parse_port_id_number_succeed() {
  keys_mod.parse_port_id_number("port-932") == "932"
}

test parse_port_id_number_transfer_succeed() {
  keys_mod.parse_port_id_number("transfer") == "100"
}

//============================is_valid_port_id====================================
test test_is_valid_port_id() {
  let test_cases =
    [
      ("port-123", True),
      ("transfer", True),
      ("client-123", True),
      // too short
      ("a", False),
      // invalid character (slash is not allowed in IBC identifiers)
      ("ports/transfer", False),
    ]

  list.all(
    test_cases,
    fn(case) { keys_mod.is_valid_port_id(case.1st) == case.2nd },
  )
}
