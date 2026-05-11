use aiken/crypto
use aiken/primitive/bytearray

pub const shard_token_prefix = "transfer-escrow"

pub fn shard_token_name(channel_id: ByteArray, denom: ByteArray) -> ByteArray {
  // One deterministic shard NFT per `{channel_id, denom}`.
  bytearray.concat(bytearray.concat(shard_token_prefix, channel_id), denom)
    |> crypto.blake2b_224()
}
