use aiken/cbor
use aiken/primitive/bytearray

/// Lifecycle delays are measured in POSIX milliseconds. Keep separate names
/// even while they share one value so deployments cannot accidentally change
/// one proof window by reusing a semantically unrelated constant.
pub const connection_retirement_delay: Int = 604_800_000

pub const channel_abandonment_delay: Int = 604_800_000

pub const host_state_proof_window: Int = 604_800_000

/// Versioned, protocol-reserved commitment path for the number of live
/// connections owned by a client.
pub fn client_connection_count_path(client_id: ByteArray) -> ByteArray {
  "cardano/dependencies/v1/clients/"
    |> bytearray.concat(client_id)
    |> bytearray.concat("/liveConnections")
}

/// Dependency counts use the same canonical Plutus-Data CBOR encoding as all
/// other HostState values. Negative counts are never representable.
pub fn encode_count(count: Int) -> ByteArray {
  expect count >= 0
  cbor.serialise(count)
}

pub fn validate_count_increment(old_count: Int, new_count: Int) -> Bool {
  old_count >= 0 && new_count == old_count + 1
}

pub fn validate_count_decrement(old_count: Int, new_count: Int) -> Bool {
  old_count > 0 && new_count == old_count - 1
}

pub fn connection_retirement_not_before(initiated_at: Int) -> Int {
  initiated_at + connection_retirement_delay
}

pub fn channel_abandonment_not_before(initiated_at: Int) -> Int {
  initiated_at + channel_abandonment_delay
}

pub fn proof_window_end(sealed_at: Int) -> Int {
  sealed_at + host_state_proof_window
}

pub fn has_reached_not_before(valid_from: Int, not_before: Int) -> Bool {
  valid_from >= not_before
}
