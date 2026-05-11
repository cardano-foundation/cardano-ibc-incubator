use ibc/utils/bytes.{add_and_concat, encode_int}

pub type Consensus {
  block: Int,
  app: Int,
}

pub fn marshal_for_consensus(consensus: Consensus) -> (Int, ByteArray) {
  let Consensus { block, app } = consensus
  (0, #"")
    |> add_and_concat(encode_int(block, bytes.field_1_varint))
    |> add_and_concat(encode_int(app, bytes.field_2_varint))
}
