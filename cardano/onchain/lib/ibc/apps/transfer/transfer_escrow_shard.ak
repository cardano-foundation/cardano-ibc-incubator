use aiken/cbor
use aiken/crypto
use cardano/transaction.{OutputReference}

pub const shard_token_domain = "transfer-escrow-v2"

pub fn shard_token_name(
  channel_id: ByteArray,
  denom: ByteArray,
  creation_input: OutputReference,
) -> ByteArray {
  // Plutus Data CBOR frames every tuple field, and the consumed transfer module
  // state makes this NFT name a one-shot identifier rather than a replayable
  // hash of public packet fields.
  cbor.serialise((shard_token_domain, channel_id, denom, creation_input))
    |> crypto.blake2b_224()
}
