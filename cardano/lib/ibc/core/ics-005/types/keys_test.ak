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
  keys_mod.parse_port_id_number("port-932") == 932
}

test parse_port_id_number_fail_if_not_found_separator() fail {
  keys_mod.parse_port_id_number("port123") == 123
}

test parse_port_id_number_fail_if_prefix_invalid() fail {
  keys_mod.parse_port_id_number("connection-123") == 123
}

test parse_port_id_number_fail_if_sequence_is_not_number() fail {
  keys_mod.parse_port_id_number("port-1x3") == 123
}

test parse_port_id_number_fail_if_sequence_is_negative() fail {
  keys_mod.parse_port_id_number("port--123") == 123
}
