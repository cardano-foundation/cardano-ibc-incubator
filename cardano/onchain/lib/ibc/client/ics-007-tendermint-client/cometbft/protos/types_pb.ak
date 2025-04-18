use ibc/utils/bytes.{add_and_concat, encode_int}

pub type Consensus {
  block: Int,
  app: Int,
}

pub fn marshal_for_consensus(consensus: Consensus) -> (Int, ByteArray) {
  let Consensus { block, app } = consensus
  (0, #"")
    |> add_and_concat(encode_int(block, 8))
    |> add_and_concat(encode_int(app, 0x10))
}
