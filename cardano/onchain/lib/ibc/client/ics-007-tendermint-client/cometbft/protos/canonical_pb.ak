use aiken/primitive/bytearray.{concat}
use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  marshal_for_timestamp, timestamp_proto,
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
    |> add_and_concat(encode_int(total, bytes.field_1_varint))
    |> size_and_concat(encode_bytearray(hash, bytes.field_2_length_delimited))
}

pub fn marshal_for_block_id(block_id: CanonicalBlockID) -> (Int, ByteArray) {
  let CanonicalBlockID { hash, part_set_header } = block_id
  (0, #"")
    |> size_and_concat(encode_bytearray(hash, bytes.field_1_length_delimited))
    |> add_and_concat(
        nest_record(
          marshal_for_part_set_header(part_set_header),
          bytes.field_2_length_delimited,
        ),
      )
}

pub fn marshal_for_vote(vote: CanonicalVote) -> (Int, ByteArray) {
  let CanonicalVote { v_type, height, round, block_id, timestamp, chain_id } =
    vote
  (0, #[])
    |> add_and_concat(encode_int(v_type, bytes.field_1_varint))
    |> add_and_concat(
        encode_int_little_endian(height, bytes.field_2_fixed64, 9),
      )
    |> add_and_concat(encode_int_little_endian(round, bytes.field_3_fixed64, 9))
    |> add_and_concat(
        nest_record(
          marshal_for_block_id(block_id),
          bytes.field_4_length_delimited,
        ),
      )
    |> add_and_concat(
        {
          expect Some(ts) = timestamp_proto(timestamp)
          nest_record(marshal_for_timestamp(ts), bytes.field_5_length_delimited)
        },
      )
    |> size_and_concat(
        encode_bytearray(chain_id, bytes.field_6_length_delimited),
      )
}

pub fn marshal_delimited_for_vote(vote: CanonicalVote) {
  let (length, bytes) = marshal_for_vote(vote)
  length
    |> encode_varint()
    |> concat(bytes)
}
