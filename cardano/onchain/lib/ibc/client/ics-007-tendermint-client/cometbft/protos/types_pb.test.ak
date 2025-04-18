use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{
  Consensus, marshal_for_consensus,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb_deprecated.{
  marshal_for_consensus as marshal_for_consensus_deprecated,
}

test test_marshal_for_consensus_same_results_empty() {
  let consensus = Consensus(0, 0)
  let (_, bytes) = marshal_for_consensus(consensus)
  let bytes_deprecated = marshal_for_consensus_deprecated(Some(consensus))
  bytes == bytes_deprecated
}

test test_marshal_for_consensus_same_results() {
  let consensus = Consensus(1337, 1442)
  let (_, bytes) = marshal_for_consensus(consensus)
  let bytes_deprecated = marshal_for_consensus_deprecated(Some(consensus))
  bytes == bytes_deprecated
}

test test_marshal_for_consensus_same_results_large() {
  let consensus = Consensus(13371337133713371337, 1442144214421442144214421442)
  let (_, bytes) = marshal_for_consensus(consensus)
  let bytes_deprecated = marshal_for_consensus_deprecated(Some(consensus))
  bytes == bytes_deprecated
}
