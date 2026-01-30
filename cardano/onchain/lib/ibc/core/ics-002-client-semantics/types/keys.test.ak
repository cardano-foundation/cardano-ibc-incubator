use aiken/collection/list
use ibc/core/ics_002_client_semantics/types/keys as keys_mod

//=================================parse_client_id_sequence===========================
test parse_client_id_sequence_succeed() {
  keys_mod.parse_client_id_sequence("07-tendermint-932") == "932"
}

//=================================is_valid_client_id===========================
test test_is_valid_client_id() {
  let test_cases =
    [
      ("07-tendermint-123", True),
      // invalid prefix
      ("ibc_client-123", False),
      // invalid sequence
      ("07-tendermint-1x3", False),
    ]

  list.all(
    test_cases,
    fn(case) { keys_mod.is_valid_client_id(case.1st) == case.2nd },
  )
}
