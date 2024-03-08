use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}

pub type Commit {
  height: Int,
  round: Int,
  block_id: BlockID,
  signatures: List<CommitSig>,
}

pub type BlockID {
  hash: ByteArray,
  part_set_header: PartSetHeader,
}

pub type PartSetHeader {
  total: Int,
  hash: ByteArray,
}

pub fn validate_basic(_commit: Commit) -> Bool {
  True
}
