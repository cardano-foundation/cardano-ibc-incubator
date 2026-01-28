use aiken/primitive/bytearray
use aiken/primitive/string

pub const port_prefix = "port"

const port_prefix_with_separator = "port-"

const port_prefix_with_separator_len = 5

pub fn format_port_identifier(port_number: Int) -> ByteArray {
  let port_number = string.from_int(port_number) |> string.to_bytearray()
  bytearray.concat(port_prefix_with_separator, port_number)
}

/// Parse number of a port_id.
/// The port_id should be a valid Cardano IBC port ID (validated with is_valid_port_id()).
///
/// Note: Port IDs in IBC are strings (eg. "transfer"), but Cardano's on-chain
/// port-token naming scheme historically derived the token postfix by stripping
/// the "port-" prefix (eg. "port-100" -> "100").
///
/// For now we support:
/// - legacy numeric port IDs: "port-{n}" -> "{n}"
/// - canonical transfer port: "transfer" -> "100" (matches deployment TRANSFER_MODULE_PORT)
pub fn parse_port_id_number(port_id: ByteArray) -> ByteArray {
  if port_id == "transfer" {
    "100"
  } else if bytearray.take(port_id, port_prefix_with_separator_len) == port_prefix_with_separator {
    bytearray.drop(port_id, port_prefix_with_separator_len)
  } else {
    fail @"Unsupported port id for port token derivation"
  }
}

pub fn is_valid_port_id(port_id: ByteArray) -> Bool {
  // IBC port identifiers are human-readable strings and are part of on-chain commitment paths,
  // so Cardano must accept the same port IDs Hermes/Cosmos uses (e.g. "transfer").
  //
  // This follows the IBC convention: 2..128 chars, restricted to an ASCII-safe set.
  //
  // NOTE: `format_port_identifier/parse_port_id_number` still exist for the legacy
  // `port-{n}` style, but `is_valid_port_id` is intentionally more permissive.
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
  (byte >= 0x30 && byte <= 0x39)
    // A-Z
    || (byte >= 0x41 && byte <= 0x5a)
    // a-z
    || (byte >= 0x61 && byte <= 0x7a)
    // Allowed punctuation: _ . + - # [ ] < >
    || byte == 0x5f
    || byte == 0x2e
    || byte == 0x2b
    || byte == 0x2d
    || byte == 0x23
    || byte == 0x5b
    || byte == 0x5d
    || byte == 0x3c
    || byte == 0x3e
}
