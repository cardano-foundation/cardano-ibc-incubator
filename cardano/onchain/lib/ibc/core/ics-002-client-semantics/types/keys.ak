use aiken/primitive/bytearray
use ibc/utils/string as string_utils

pub const client_prefix = "ibc_client"

// IBC client identifiers are part of the on-chain IBC data model (they appear inside
// connection/channel state and in the IBC store keyspace).
//
// For Cosmos parity, Cardano uses the canonical IBC identifier format:
//   `{client-type}-{sequence}`
//
// For Tendermint clients, that means:
//   `07-tendermint-{sequence}`
//
// NOTE: `client_prefix` above is used for *auth token name derivation* in the STT
// architecture. It is intentionally NOT the same as the on-chain client identifier
// prefix.
const client_id_prefix_with_separator = "07-tendermint-"

const client_id_prefix_with_separator_len = 14

/// Parse sequence number of a client_id.
/// The client_id should be a valid Cardano IBC client ID (validated with is_valid_client_id()).
pub fn parse_client_id_sequence(client_id: ByteArray) -> ByteArray {
  bytearray.drop(client_id, client_id_prefix_with_separator_len)
}

pub fn is_valid_client_id(client_id: ByteArray) -> Bool {
  let prefix = bytearray.take(client_id, client_id_prefix_with_separator_len)
  if prefix == client_id_prefix_with_separator {
    let str_id = bytearray.drop(client_id, client_id_prefix_with_separator_len)
    string_utils.is_uint_string(str_id)
  } else {
    False
  }
}
