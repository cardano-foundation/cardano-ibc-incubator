use aiken/collection/list
use aiken/math/rational.{Rational}
use ibc/client/ics_007_tendermint_client/cometbft/adjacent_validation
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/non_adjacent_validation
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}

pub fn verify_commit_light(
  chain_id: ByteArray,
  vals: ValidatorSet,
  block_id: BlockID,
  height: Int,
  commit: Commit,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  expect verify_basic_vals_and_commit(vals, commit, height, block_id)
  let total_voting_power = validator_set.total_voting_power(vals)
  expect validator_set.valid_total_voting_power(total_voting_power)
  let voting_power_needed = total_voting_power * 2 / 3

  if should_batch_verify(vals, commit) {
    let ignore =
      fn(c: CommitSig) -> Bool { c.block_id_flag != block_id_flag_commit }
    let count =
      fn(_c: CommitSig) -> Bool { True }
    verify_commit_batch(
      chain_id,
      vals,
      commit,
      voting_power_needed,
      ignore,
      count,
      False,
      True,
    )
  } else {
    adjacent_validation.verify_commit_single(
      chain_id,
      vals.validators,
      commit,
      voting_power_needed,
      list_vote_sign_bytes,
    )
  }
}

pub fn verify_commit_light_trusting(
  chain_id: ByteArray,
  vals: ValidatorSet,
  commit: Commit,
  trust_level: Rational,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  non_adjacent_validation.verify_commit_light_trusting(
    chain_id,
    vals,
    commit,
    trust_level,
    list_vote_sign_bytes,
  )
}

fn verify_basic_vals_and_commit(
  vals: ValidatorSet,
  commit: Commit,
  height: Int,
  block_id: BlockID,
) -> Bool {
  expect !list.is_empty(vals.validators)
  expect !list.is_empty(commit.signatures)
  expect validator_set.size(vals) == list.length(commit.signatures)
  expect height == commit.height
  expect block_id == commit.block_id
  True
}

/// This function is always return False because we haven't implemented 
/// BatchVerifier implements batch verification for pubkey
fn should_batch_verify(_vals: ValidatorSet, _commit: Commit) -> Bool {
  // list.length(commit.signatures) >= batch_verify_threshold && batch.supports_batch_verifier(vals.get_proposer().pubkey) 
  False
}

/// Batch verification
/// TODO: Need to implement batch verification for ed25519 and sr25519 pubkey
fn verify_commit_batch(
  _chain_id: ByteArray,
  _vals: ValidatorSet,
  _commit: Commit,
  _voting_power_needed: Int,
  _ignore_sig: fn(CommitSig) -> Bool,
  _count_sig: fn(CommitSig) -> Bool,
  _count_all_signatures: Bool,
  _lock_up_by_index: Bool,
) -> Bool {
  // TODO
  True
}
