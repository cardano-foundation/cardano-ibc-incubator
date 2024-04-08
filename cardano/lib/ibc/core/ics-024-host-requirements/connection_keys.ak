use aiken/bytearray

pub const default_merkle_prefix = "ibc"

pub const key_connection_prefix = "connections"

pub fn connection_path(connection_id: ByteArray) {
  key_connection_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(connection_id)
}

test test_connection_path() {
  connection_path("abc") == "connections/abc"
}
