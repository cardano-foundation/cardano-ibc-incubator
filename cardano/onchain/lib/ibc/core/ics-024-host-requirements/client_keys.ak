use aiken/primitive/bytearray

pub const key_client_store_prefix = "clients"

pub const key_client_state = "clientState"

pub const key_client_consensus_states = "consensusStates"

pub fn full_client_path(client_id: ByteArray, path: ByteArray) -> ByteArray {
  key_client_store_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(client_id)
    |> bytearray.concat("/")
    |> bytearray.concat(path)
}

pub fn full_client_state_path(client_id: ByteArray) -> ByteArray {
  full_client_path(client_id, key_client_state)
}

pub fn full_client_consensus_state_path(
  client_id: ByteArray,
  height: ByteArray,
) -> ByteArray {
  full_client_path(client_id, key_client_consensus_states)
    |> bytearray.concat("/")
    |> bytearray.concat(height)
}

test test_full_client_path() {
  full_client_path("client-id", "path") == "clients/client-id/path"
}

test test_full_client_state_path() {
  full_client_state_path("client-id") == "clients/client-id/clientState"
}

test test_full_client_consensus_state_path() {
  full_client_consensus_state_path("client-id", "123") == "clients/client-id/consensusStates/123"
}
