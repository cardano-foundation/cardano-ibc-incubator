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
