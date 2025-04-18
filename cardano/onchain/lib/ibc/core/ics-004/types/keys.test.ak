use aiken/collection/list
use ibc/core/ics_004/types/keys as keys_mod

//============================format_channel_identifier====================================
test test_format_channel_identifier() {
  keys_mod.format_channel_identifier(#"3938") == "channel-98"
}

//============================parse_channel_id_sequence====================================
test succeed_parse_channel_id_sequence() {
  keys_mod.parse_channel_id_sequence("channel-932") == "932"
}

//============================is_valid_channel_id====================================
test test_is_valid_channel_id() {
  let test_cases =
    [
      ("channel-123", True),
      // invalid prefix
      ("client-123", False),
      // invalid sequence
      ("channel-1x3", False),
    ]

  list.all(
    test_cases,
    fn(case) { keys_mod.is_valid_channel_id(case.1st) == case.2nd },
  )
}
