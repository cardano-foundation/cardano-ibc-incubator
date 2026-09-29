use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use ibc/core/ics_024_host_requirements/validate
use ibc/utils/int as int_utils

pub const max_packet_lanes = 64

pub const max_packet_sequence = 18_446_744_073_709_551_615

pub fn valid_lane_count(count: Int) -> Bool {
  count > 0 && count <= max_packet_lanes
}

fn framed(value: ByteArray) -> ByteArray {
  bytearray.from_int_big_endian(bytearray.length(value), 4)
    |> bytearray.concat(value)
}

fn channel_identity(port: ByteArray, channel: ByteArray) -> ByteArray {
  expect validate.port_identifier_validator(port)
  expect bytearray.take(channel, 8) == "channel-"
  let suffix = bytearray.drop(channel, 8)
  expect Some(sequence) = int.from_utf8(suffix)
  expect sequence >= 0 && sequence <= max_packet_sequence
  expect int_utils.to_string(sequence) == suffix
  framed(port) |> bytearray.concat(framed(channel))
}

/// Membership, receipt and acknowledgement keys share their sequence's lane.
/// Consecutive sequences occupy distinct lanes until the fixed count wraps.
pub fn packet_lane(
  port: ByteArray,
  channel: ByteArray,
  sequence: Int,
  count: Int,
) -> Int {
  expect valid_lane_count(count)
  expect sequence > 0 && sequence <= max_packet_sequence
  expect _ = channel_identity(port, channel)
  sequence % count
}

pub fn lane_token_name(
  port: ByteArray,
  channel: ByteArray,
  lane: Int,
  count: Int,
) -> ByteArray {
  expect valid_lane_count(count)
  expect lane >= 0 && lane < count
  "cardano-ibc/packet-lane-token/v1"
    |> bytearray.concat(#[0])
    |> bytearray.concat(channel_identity(port, channel))
    |> bytearray.concat(bytearray.from_int_big_endian(lane, 4))
    |> crypto.sha2_256
}

pub fn sequencer_token_name(port: ByteArray, channel: ByteArray) -> ByteArray {
  "cardano-ibc/send-sequencer-token/v1"
    |> bytearray.concat(#[0])
    |> bytearray.concat(channel_identity(port, channel))
    |> crypto.sha2_256
}

pub fn liquidity_token_name(
  port: ByteArray,
  channel: ByteArray,
  denom: ByteArray,
  deposit_tx_hash: ByteArray,
  deposit_output_index: Int,
) -> ByteArray {
  expect denom != ""
  expect bytearray.length(deposit_tx_hash) == 32
  expect deposit_output_index >= 0 && deposit_output_index <= 4_294_967_295
  "cardano-ibc/transfer-liquidity-token/v1"
    |> bytearray.concat(#[0])
    |> bytearray.concat(channel_identity(port, channel))
    |> bytearray.concat(framed(denom))
    |> bytearray.concat(deposit_tx_hash)
    |> bytearray.concat(bytearray.from_int_big_endian(deposit_output_index, 4))
    |> crypto.sha2_256
}
