use ibc/core/ics_002_client_semantics/types/keys as keys_mod

//=================================parse_client_id_sequence===========================
test parse_client_id_sequence_succeed() {
  keys_mod.parse_client_id_sequence("ibc_client-932") == 932
}

test parse_client_id_sequence_fail_if_not_found_separator() fail {
  keys_mod.parse_client_id_sequence("ibc_client123") == 123
}

test parse_client_id_sequence_fail_if_prefix_invalid() fail {
  keys_mod.parse_client_id_sequence("connection-123") == 123
}

test parse_client_id_sequence_fail_if_sequence_is_not_number() fail {
  keys_mod.parse_client_id_sequence("ibc_client-1x3") == 123
}

test parse_client_id_sequence_fail_if_sequence_is_negative() fail {
  keys_mod.parse_client_id_sequence("ibc_client--123") == 123
}
