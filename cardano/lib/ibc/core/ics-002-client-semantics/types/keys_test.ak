use ibc/core/ics_002_client_semantics/types/keys as keys_mod

//=================================parse_client_id_sequence===========================
test parse_client_id_sequence_succeed() {
  keys_mod.parse_client_id_sequence("ibc_client-932") == "932"
}
