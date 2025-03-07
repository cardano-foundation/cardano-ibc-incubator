use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/canonical_pb.{
  CanonicalBlockID, CanonicalPartSetHeader, CanonicalVote as CanonicalVoteProto,
}
use ibc/client/ics_007_tendermint_client/cometbft/types.{SignedMsgType}
use ibc/utils/time.{Time}

pub type CanonicalVote {
  vote_type: SignedMsgType,
  height: Int,
  round: Int,
  block_id: CanonicalBlockID,
  timestamp: Time,
  chain_id: ByteArray,
}

pub fn convert_to_canonical_vote_proto(cv: CanonicalVote) -> CanonicalVoteProto {
  CanonicalVoteProto {
    v_type: cv.vote_type,
    height: cv.height,
    round: cv.round,
    block_id: cv.block_id,
    timestamp: cv.timestamp,
    chain_id: cv.chain_id,
  }
}

pub fn canonicalize_part_set_header(
  psh: PartSetHeader,
) -> CanonicalPartSetHeader {
  CanonicalPartSetHeader { total: psh.total, hash: psh.hash }
}

pub fn canonicalize_block_id(bid: BlockID) -> CanonicalBlockID {
  CanonicalBlockID {
    hash: bid.hash,
    part_set_header: canonicalize_part_set_header(bid.part_set_header),
  }
}
