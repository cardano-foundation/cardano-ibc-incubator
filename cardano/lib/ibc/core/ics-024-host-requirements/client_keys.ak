use aiken/primitive/bytearray

pub const key_client_store_prefix = "clients"

pub const key_client_state = "clientState"

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

test test_full_client_path() {
  full_client_path("client-id", "path") == "clients/client-id/path"
}

test test_full_client_state_path() {
  full_client_state_path("client-id") == "clients/client-id/clientState"
}
