use aiken/primitive/bytearray.{concat}
use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  marshal_for_timestamp_v2, timestamp_proto,
}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_int_little_endian,
  encode_varint, nest_record, size_and_concat,
}
use ibc/utils/int.{Int32, Int64}
use ibc/utils/time.{Time}

pub type SignedMsgType =
  Int32

pub type CanonicalPartSetHeader {
  total: Int32,
  hash: ByteArray,
}

pub type CanonicalBlockID {
  hash: ByteArray,
  part_set_header: CanonicalPartSetHeader,
}

pub type CanonicalVote {
  v_type: SignedMsgType,
  height: Int64,
  round: Int64,
  block_id: CanonicalBlockID,
  timestamp: Time,
  chain_id: ByteArray,
}

pub fn marshal_for_part_set_header(
  psh: CanonicalPartSetHeader,
) -> (Int, ByteArray) {
  let CanonicalPartSetHeader { total, hash } = psh
  // total |> uint64() |> sov() |> add(1)
  (0, #[])
    |> add_and_concat(encode_int(total, 8))
    |> size_and_concat(encode_bytearray(hash, 0x12))
}

pub fn marshal_for_block_id(block_id: CanonicalBlockID) -> (Int, ByteArray) {
  let CanonicalBlockID { hash, part_set_header } = block_id
  (0, #"")
    |> size_and_concat(encode_bytearray(hash, 10))
    |> add_and_concat(
        nest_record(marshal_for_part_set_header(part_set_header), 0x12),
      )
}

pub fn marshal_for_vote(vote: CanonicalVote) -> (Int, ByteArray) {
  let CanonicalVote { v_type, height, round, block_id, timestamp, chain_id } =
    vote
  (0, #[])
    |> add_and_concat(encode_int(v_type, 8))
    |> add_and_concat(encode_int_little_endian(height, 0x11, 9))
    |> add_and_concat(encode_int_little_endian(round, 0x19, 9))
    |> add_and_concat(nest_record(marshal_for_block_id(block_id), 0x22))
    |> add_and_concat(
        {
          expect Some(ts) = timestamp_proto(timestamp)
          nest_record(marshal_for_timestamp_v2(ts), 0x2a)
        },
      )
    |> size_and_concat(encode_bytearray(chain_id, 0x32))
}

pub fn marshal_delimited_for_vote(vote: CanonicalVote) {
  let (length, bytes) = marshal_for_vote(vote)

  length
    |> encode_varint()
    |> concat(bytes)
}
