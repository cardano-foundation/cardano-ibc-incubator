use ibc/client/ics_007_tendermint_client/cometbft/protos/commitment_pb.{
  marshal_for_merkle_prefix,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/commitment_pb_deprecated.{
  marshal_for_merkle_prefix as marshal_for_merkle_prefix_deprecated,
  size_for_merkle_prefix as size_for_merkle_prefix_deprecated,
}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

test marshal_for_merkle_prefix_produces_same_results() {
  let (length, bytes) = marshal_for_merkle_prefix(MerklePrefix(#"0501"))
  let bytes_deprecated =
    marshal_for_merkle_prefix_deprecated(Some(MerklePrefix(#"0501")))
  let length_deprecated =
    size_for_merkle_prefix_deprecated(Some(MerklePrefix(#"0501")))
  length == length_deprecated && bytes == bytes_deprecated
}
