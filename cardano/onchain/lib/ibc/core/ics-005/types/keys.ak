use aiken/crypto
use aiken/primitive/bytearray

/// Domain separator for the v2 port capability-token name.
///
/// Port identifiers can be up to 128 bytes, while Cardano asset names are
/// limited to 32 bytes, so the exact identifier cannot be embedded directly.
pub const port_token_domain = "cardano-ibc/port-token/v1"

/// Derive the fixed-width capability-token name for an exact textual port ID.
///
/// The dedicated minting policy already scopes the token to one deployment;
/// hashing the domain and complete identifier avoids truncation and aliasing.
pub fn port_token_name(port_id: ByteArray) -> ByteArray {
  expect is_valid_port_id(port_id)?
  port_token_domain
    |> bytearray.concat(#"00")
    |> bytearray.concat(port_id)
    |> crypto.blake2b_256
}

pub fn is_valid_port_id(port_id: ByteArray) -> Bool {
  // IBC port identifiers are human-readable strings and are part of on-chain commitment paths,
  // so Cardano must accept the same port IDs Hermes/Cosmos uses (e.g. "transfer").
  //
  // This follows the IBC convention: 2..128 chars, restricted to an ASCII-safe set.
  //
  let len = bytearray.length(port_id)
  if len < 2 || len > 128 {
    False
  } else {
    bytearray.foldr(
      port_id,
      True,
      fn(byte, acc) { acc && is_valid_port_char(byte) },
    )
  }
}

fn is_valid_port_char(byte: Int) -> Bool {
  // 0-9
  byte >= 0x30 && byte <= 0x39 || // A-Z
  byte >= 0x41 && byte <= 0x5a || // a-z
  byte >= 0x61 && byte <= 0x7a || // Allowed punctuation: _ . + - # [ ] < >
  byte == 0x5f || byte == 0x2e || byte == 0x2b || byte == 0x2d || byte == 0x23 || byte == 0x5b || byte == 0x5d || byte == 0x3c || byte == 0x3e
}
