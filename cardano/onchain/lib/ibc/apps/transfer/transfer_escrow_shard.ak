use aiken/crypto
use aiken/primitive/bytearray.{from_int_big_endian}
use cardano/transaction.{OutputReference}

pub const shard_token_domain = "transfer-escrow-v2"

fn frame(value: ByteArray) -> ByteArray {
  bytearray.concat(from_int_big_endian(bytearray.length(value), 8), value)
}

pub fn shard_token_name(
  channel_id: ByteArray,
  denom: ByteArray,
  creation_input: OutputReference,
) -> ByteArray {
  let OutputReference { transaction_id, output_index } = creation_input

  // Every variable-width field is length-delimited, and the consumed transfer
  // module state makes this NFT name a one-shot identifier rather than a
  // replayable hash of public packet fields.
  bytearray.concat(
    bytearray.concat(
      bytearray.concat(frame(shard_token_domain), frame(channel_id)),
      frame(denom),
    ),
    bytearray.concat(
      frame(transaction_id),
      from_int_big_endian(output_index, 8),
    ),
  )
    |> crypto.blake2b_224()
}
