// DO NOT EDIT.
// source: tendermint/types/canonical.proto

use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, from_int_little_endian, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  marshal_for_timestamp, marshal_for_timestamp_v2, size_for_timestamp,
  size_of_std_time, timestamp_proto,
}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_int_little_endian,
  encode_varint, nest_record, size_and_concat, sov,
}
use ibc/utils/int.{Int32, Int64, uint64}
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
  block_id: Option<CanonicalBlockID>,
  timestamp: Time,
  chain_id: ByteArray,
}

pub type CanonicalVoteV2 {
  v_type: SignedMsgType,
  height: Int64,
  round: Int64,
  block_id: CanonicalBlockID,
  timestamp: Time,
  chain_id: ByteArray,
}

pub fn marshal_for_part_set_header_v2(
  psh: CanonicalPartSetHeader,
) -> (Int, ByteArray) {
  let CanonicalPartSetHeader { total, hash } = psh
  // total |> uint64() |> sov() |> add(1)
  (0, #[])
    |> add_and_concat(encode_int(total, 8))
    |> size_and_concat(encode_bytearray(hash, 0x12))
}

pub fn marshal_for_part_set_header(
  psh_opt: Option<CanonicalPartSetHeader>,
) -> ByteArray {
  ite(
    is_none(psh_opt),
    #[],
    {
      expect Some(psh) = psh_opt
      let CanonicalPartSetHeader { total, hash } = psh
      #[]
        |> concat(
            ite(
              total == 0,
              #[],
              total |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(
              length(hash) == 0,
              #[],
              hash
                |> length()
                |> encode_varint()
                |> concat(hash)
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn marshal_delimited_for_vote(vote_opt: Option<CanonicalVote>) {
  vote_opt
    |> size_for_vote()
    |> encode_varint()
    |> concat(marshal_for_vote(vote_opt))
}

pub fn size_for_part_set_header(
  part_set_header_opt: Option<CanonicalPartSetHeader>,
) -> Int {
  ite(
    is_none(part_set_header_opt),
    0,
    {
      expect Some(psh) = part_set_header_opt
      let CanonicalPartSetHeader { total, hash } = psh
      0
        |> add(ite(total == 0, 0, total |> uint64() |> sov() |> add(1)))
        |> add(
            ite(
              length(hash) == 0,
              0,
              {
                let l = length(hash)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}

pub fn marshal_for_block_id_v2(block_id: CanonicalBlockID) -> (Int, ByteArray) {
  let CanonicalBlockID { hash, part_set_header } = block_id
  (0, #"")
    |> size_and_concat(encode_bytearray(hash, 10))
    |> add_and_concat(
        nest_record(marshal_for_part_set_header_v2(part_set_header), 0x12),
      )
}

pub fn marshal_for_block_id(block_id_opt: Option<CanonicalBlockID>) -> ByteArray {
  ite(
    is_none(block_id_opt),
    #[],
    {
      expect Some(block_id) = block_id_opt
      let CanonicalBlockID { hash, part_set_header } = block_id
      #[]
        |> concat(
            ite(
              length(hash) == 0,
              #[],
              hash
                |> length()
                |> encode_varint()
                |> concat(hash)
                |> push(10),
            ),
          )
        |> concat(
            part_set_header
              |> Some
              |> size_for_part_set_header()
              |> encode_varint()
              |> concat(marshal_for_part_set_header(Some(part_set_header)))
              |> push(0x12),
          )
    },
  )
}

pub fn size_for_block_id(block_id_opt: Option<CanonicalBlockID>) -> Int {
  ite(
    is_none(block_id_opt),
    0,
    {
      expect Some(block_id) = block_id_opt
      let CanonicalBlockID { hash, part_set_header } = block_id
      0
        |> add(
            ite(
              length(hash) == 0,
              0,
              {
                let l = length(hash)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            {
              let l = size_for_part_set_header(Some(part_set_header))
              l |> sov() |> add(l + 1)
            },
          )
    },
  )
}

pub fn marshal_for_vote_v2(vote: CanonicalVoteV2) -> (Int, ByteArray) {
  let CanonicalVoteV2 { v_type, height, round, block_id, timestamp, chain_id } =
    vote
  (0, #[])
    |> add_and_concat(encode_int(v_type, 8))
    |> add_and_concat(encode_int_little_endian(height, 0x11, 9))
    |> add_and_concat(encode_int_little_endian(round, 0x19, 9))
    |> add_and_concat(nest_record(marshal_for_block_id_v2(block_id), 0x22))
    |> add_and_concat(
        {
          expect Some(ts) = timestamp_proto(timestamp)
          nest_record(marshal_for_timestamp_v2(ts), 0x2a)
        },
      )
    |> size_and_concat(encode_bytearray(chain_id, 0x32))
}

pub fn marshal_for_vote(vote_opt: Option<CanonicalVote>) -> ByteArray {
  ite(
    is_none(vote_opt),
    #[],
    {
      expect Some(vote) = vote_opt
      let CanonicalVote { v_type, height, round, block_id, timestamp, chain_id } =
        vote

      #[]
        |> concat(
            ite(
              v_type == 0,
              #[],
              v_type |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(
              height == 0,
              #[],
              height |> from_int_little_endian(8) |> push(0x11),
            ),
          )
        |> concat(
            ite(
              round == 0,
              #[],
              round |> from_int_little_endian(8) |> push(0x19),
            ),
          )
        |> concat(
            ite(
              is_none(block_id),
              #[],
              block_id
                |> size_for_block_id()
                |> encode_varint()
                |> concat(marshal_for_block_id(block_id))
                |> push(0x22),
            ),
          )
        |> concat(
            {
              let ts_opt = timestamp_proto(timestamp)
              ts_opt
                |> size_for_timestamp()
                |> encode_varint()
                |> concat(marshal_for_timestamp(ts_opt))
                |> push(0x2a)
            },
          )
        |> concat(
            ite(
              length(chain_id) == 0,
              #[],
              chain_id
                |> length()
                |> encode_varint()
                |> concat(chain_id)
                |> push(0x32),
            ),
          )
    },
  )
}

pub fn size_for_vote(vote_opt: Option<CanonicalVote>) -> Int {
  ite(
    is_none(vote_opt),
    0,
    {
      expect Some(vote) = vote_opt
      let CanonicalVote { v_type, height, round, block_id, timestamp, chain_id } =
        vote
      0
        |> add(ite(v_type == 0, 0, v_type |> uint64() |> sov() |> add(1)))
        |> add(ite(height == 0, 0, 9))
        |> add(ite(round == 0, 0, 9))
        |> add(
            ite(
              is_none(block_id),
              0,
              {
                let l = size_for_block_id(block_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            {
              let l = size_of_std_time(timestamp)
              l |> sov() |> add(l + 1)
            },
          )
        |> add(
            ite(
              length(chain_id) == 0,
              0,
              {
                let l = length(chain_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}
