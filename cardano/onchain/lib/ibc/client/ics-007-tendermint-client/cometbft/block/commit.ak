use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
} as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}

pub type Commit {
  height: Int,
  round: Int,
  block_id: BlockID,
  signatures: List<CommitSig>,
}

pub fn validate_basic(commit: Commit) -> Bool {
  and {
    commit.height >= 0 && commit.round >= 0,
    if commit.height >= 1 {
      and {
        !is_zero_block_id(commit.block_id),
        list.length(commit.signatures) > 0,
        commit.signatures
          |> list.all(
              fn(com_sig) { commit_sig.validate_basic(com_sig) == True },
            ),
      }
    } else {
      True
    },
  }
}

pub fn null_commit() -> Commit {
  Commit {
    height: 0,
    round: 0,
    block_id: block_id_mod.null_block_id(),
    signatures: [],
  }
}

fn is_zero_block_id(block_id: BlockID) -> Bool {
  block_id.hash == #"" && is_zero_part_set_header(block_id.part_set_header)
}

fn is_zero_part_set_header(part_set_header: PartSetHeader) -> Bool {
  part_set_header.total == 0 && part_set_header.hash == #""
}
