use ibc/core/ics_004/types/keys as keys_mod

//============================format_channel_identifier====================================
test test_format_channel_identifier() {
  keys_mod.format_channel_identifier(#"3938") == "channel-98"
}

//============================parse_channel_id_sequence====================================
test succeed_parse_channel_id_sequence() {
  keys_mod.parse_channel_id_sequence("channel-932") == "932"
}
