use aiken/collection/list
use aiken/primitive/bytearray
use ibc/core/ics_005/types/keys as keys_mod

test port_token_name_is_full_width_and_identifier_specific() {
  let transfer_name = keys_mod.port_token_name("transfer")
  and {
    bytearray.length(transfer_name) == 32,
    transfer_name == #"04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
    transfer_name != keys_mod.port_token_name("icqhost"),
    transfer_name != keys_mod.port_token_name("Transfer"),
  }
}

test port_token_name_rejects_invalid_identifier() fail {
  keys_mod.port_token_name("ports/transfer") == ""
}

test port_token_name_accepts_maximum_length_identifier() {
  let segment = "abcdefghijklmnopqrstuvwxYZ012345"
  let port_id =
    segment
      |> bytearray.concat(segment)
      |> bytearray.concat(segment)
      |> bytearray.concat(segment)
  and {
    bytearray.length(port_id) == 128,
    bytearray.length(keys_mod.port_token_name(port_id)) == 32,
  }
}

//============================is_valid_port_id====================================
test test_is_valid_port_id() {
  let test_cases =
    [
      ("port-123", True), ("transfer", True), ("client-123", True),
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
