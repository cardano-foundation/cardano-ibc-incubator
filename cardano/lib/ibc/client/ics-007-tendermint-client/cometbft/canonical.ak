use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{
  BlockID, PartSetHeader,
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

pub type CanonicalBlockID {
  hash: ByteArray,
  part_set_header: CanonicalPartSetHeader,
}

pub type CanonicalPartSetHeader {
  total: Int,
  hash: ByteArray,
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
