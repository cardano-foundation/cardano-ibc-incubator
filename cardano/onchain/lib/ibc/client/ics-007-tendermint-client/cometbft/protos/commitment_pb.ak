use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/utils/bytes.{encode_bytearray, size_and_concat}

pub fn marshal_for_merkle_prefix(
  merkle_prefix: MerklePrefix,
) -> (Int, ByteArray) {
  let MerklePrefix { key_prefix } = merkle_prefix
  (0, #[])
    |> size_and_concat(encode_bytearray(key_prefix, 10))
}
