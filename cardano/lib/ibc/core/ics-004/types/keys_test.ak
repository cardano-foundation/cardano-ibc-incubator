use ibc/core/ics_004/types/keys as keys_mod

//============================format_channel_identifier====================================
test test_format_channel_identifier_fail_with_negative_sequence() fail {
  keys_mod.format_channel_identifier(-1) == ""
}

test test_format_channel_identifier() {
  keys_mod.format_channel_identifier(98) == "channel-98"
}

//============================parse_channel_id_sequence====================================
test succeed_parse_channel_id_sequence() {
  keys_mod.parse_channel_id_sequence("channel-932") == Some(932)
}

test fail_parse_channel_id_sequence_if_not_found_separator() {
  keys_mod.parse_channel_id_sequence("channel123") == None
}

test fail_parse_channel_id_sequence_if_prefix_invalid() {
  keys_mod.parse_channel_id_sequence("connection-123") == None
}

test fail_parse_channel_id_sequence_if_sequence_is_not_number() {
  keys_mod.parse_channel_id_sequence("channel-1x3") == None
}

test fail_parse_channel_id_sequence_if_sequence_is_negative() {
  keys_mod.parse_channel_id_sequence("channel--123") == None
}
