use aiken/list
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{BlockID, Commit}
use ibc/client/ics_007_tendermint_client/cometbft/canonical.{CanonicalVote}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{precommit_type}
use ibc/client/ics_007_tendermint_client/cometbft/types.{SignedMsgType}
use ibc/utils/time.{Time}

pub type Vote {
  vote_type: SignedMsgType,
  height: Int,
  round: Int,
  block_id: BlockID,
  timestamp: Time,
  validator_address: ByteArray,
  validator_index: Int,
  signature: ByteArray,
  extension: ByteArray,
  extension_signature: ByteArray,
}

pub fn validate_basic(_vote: Vote) -> Bool {
  True
}

pub fn get_vote(commit: Commit, val_idx: Int) -> Vote {
  expect Some(commit_sig) = list.at(commit.signatures, val_idx)
  Vote {
    vote_type: precommit_type,
    height: commit.height,
    round: commit.round,
    block_id: commit.block_id,
    timestamp: commit_sig.timestamp,
    validator_address: commit_sig.validator_address,
    validator_index: val_idx,
    signature: commit_sig.signature,
    extension: #"",
    extension_signature: #"",
  }
}

pub fn canonicalize_vote(chain_id: ByteArray, vote: Vote) -> CanonicalVote {
  CanonicalVote {
    vote_type: vote.vote_type,
    height: vote.height,
    round: vote.round,
    block_id: canonical.canonicalize_block_id(vote.block_id),
    timestamp: vote.timestamp,
    chain_id,
  }
}

pub fn vote_sign_bytes(_chain_id: ByteArray, _vote: Vote) -> ByteArray {
  // let pb = canonicalize_vote(chain_id, vote)
  #[]
}

pub fn vote_sign_bytes_for_commit(
  commit: Commit,
  chain_id: ByteArray,
  val_idx: Int,
) -> ByteArray {
  let v = get_vote(commit, val_idx)
  vote_sign_bytes(chain_id, v)
}
