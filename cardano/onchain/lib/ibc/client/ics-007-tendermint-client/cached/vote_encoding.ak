use aiken/primitive/bytearray
use ibc/utils/bytes
use ibc/utils/int.{uint64}

/// Encode the timestamp directly into the already prepared commit vote parts.
/// The timestamp wire payload is at most seventeen bytes, so its nested length
/// always fits in one byte even when negative seconds need ten varint bytes.
pub fn commit_sign_bytes(
  prefix: ByteArray,
  suffix: ByteArray,
  timestamp: Int,
) -> ByteArray {
  let seconds = timestamp / 1_000_000_000
  let nanos = timestamp % 1_000_000_000
  expect and {
      seconds >= -62_135_596_800,
      seconds < 253_402_300_800,
      nanos >= 0,
      nanos <= 1_000_000_000,
    }
  let encoded_seconds =
    if seconds == 0 {
      #""
    } else {
      bytes.encode_varint(
        if seconds < 0 {
          uint64(seconds)
        } else {
          seconds
        },
      )
        |> bytearray.push(8)
    }
  let encoded_nanos =
    if nanos == 0 {
      #""
    } else {
      bytes.encode_varint(nanos) |> bytearray.push(16)
    }
  let payload = bytearray.concat(encoded_seconds, encoded_nanos)
  let encoded_time =
    payload
      |> bytearray.push(bytearray.length(payload))
      |> bytearray.push(42)
  let encoded =
    prefix
      |> bytearray.concat(encoded_time)
      |> bytearray.concat(suffix)
  bytes.encode_varint(bytearray.length(encoded)) |> bytearray.concat(encoded)
}
