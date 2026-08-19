use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/string

pub const shard_token_domain = "cardano-ibc/transfer-escrow-shard/v1"

pub const shard_registry_key_prefix = "escrowShards/"

pub const registered_shard_value = #"01"

const uint32_max = 4_294_967_295

pub fn shard_token_preimage(
  channel_id: ByteArray,
  denom: ByteArray,
) -> ByteArray {
  let channel_id_length = bytearray.length(channel_id)
  let denom_length = bytearray.length(denom)
  expect channel_id_length <= uint32_max
  expect denom_length <= uint32_max

  shard_token_domain
    |> bytearray.concat(#[0])
    |> bytearray.concat(bytearray.from_int_big_endian(channel_id_length, 4))
    |> bytearray.concat(channel_id)
    |> bytearray.concat(bytearray.from_int_big_endian(denom_length, 4))
    |> bytearray.concat(denom)
}

pub fn shard_token_name(channel_id: ByteArray, denom: ByteArray) -> ByteArray {
  // One deterministic shard NFT per `{channel_id, denom}`.
  shard_token_preimage(channel_id, denom)
    |> crypto.blake2b_224
}

pub fn shard_registry_key(channel_id: ByteArray, denom: ByteArray) -> ByteArray {
  let token_name_hex =
    shard_token_name(channel_id, denom)
      |> bytearray.to_hex
      |> string.to_bytearray
      |> ascii_lower
  bytearray.concat(shard_registry_key_prefix, token_name_hex)
}

fn ascii_lower(bytes: ByteArray) -> ByteArray {
  bytearray.foldr(
    bytes,
    "",
    fn(byte, acc) {
      bytearray.push(
        acc,
        if byte >= 65 && byte <= 90 {
          byte + 32
        } else {
          byte
        },
      )
    },
  )
}
