use aiken/builtin
use aiken/list
use aiken/math/rational.{Rational}
use aiken/option
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/vote

pub fn verify_commit_light(
  chain_id: ByteArray,
  vals: ValidatorSet,
  block_id: BlockID,
  height: Int,
  commit: Commit,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  expect verify_basic_vals_and_commit(vals, commit, height, block_id)
  let voting_power_needed = validator_set.total_voting_power(vals) * 2 / 3

  let ignore =
    fn(c: CommitSig) -> Bool { c.block_id_flag != block_id_flag_commit }
  let count =
    fn(_c: CommitSig) -> Bool { True }

  if should_batch_verify(vals, commit) {
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
    verify_commit_single(
      chain_id,
      vals,
      commit,
      voting_power_needed,
      ignore,
      count,
      False,
      True,
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
  expect !list.is_empty(vals.validators)
  expect rational.denominator(trust_level) != 0
  expect !list.is_empty(commit.signatures)
  let voting_power_needed =
    validator_set.total_voting_power(vals) * rational.numerator(trust_level) / rational.denominator(
      trust_level,
    )
  let ignore =
    fn(c: CommitSig) -> Bool { c.block_id_flag != block_id_flag_commit }
  let count =
    fn(_c: CommitSig) -> Bool { True }
  if should_batch_verify(vals, commit) {
    verify_commit_batch(
      chain_id,
      vals,
      commit,
      voting_power_needed,
      ignore,
      count,
      False,
      False,
    )
  } else {
    verify_commit_single(
      chain_id,
      vals,
      commit,
      voting_power_needed,
      ignore,
      count,
      False,
      False,
      list_vote_sign_bytes,
    )
  }
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

/// Single Verification
/// Note: Default to using verify_ed25519_signature to verify the validator operator's signature
fn verify_commit_single(
  chain_id: ByteArray,
  vals: ValidatorSet,
  commit: Commit,
  voting_power_needed: Int,
  ignore_sig: fn(CommitSig) -> Bool,
  count_sig: fn(CommitSig) -> Bool,
  count_all_signatures: Bool,
  lock_up_by_index: Bool,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  let (tallied_voting_power, _seen_vals, partial_passed) =
    list.indexed_foldr(
      commit.signatures,
      (0, [], False),
      fn(idx, commit_sig, acc) {
        if ignore_sig(commit_sig) || acc.3rd {
          acc
        } else {
          let found_val =
            if lock_up_by_index {
              list.at(vals.validators, idx)
                |> option.map(fn(val) { (val, acc.2nd) })
            } else {
              validator_set.get_by_address(vals, commit_sig.validator_address)
                |> option.map(
                    fn(result) {
                      expect !list.has(acc.2nd, result.1st)

                      (result.2nd, [result.1st, ..acc.2nd])
                    },
                  )
            }

          when found_val is {
            Some((val, seen_vals)) -> {
              let vote_sign_bytes =
                when list_vote_sign_bytes is {
                  Some(list_vote_sign_bytes) -> {
                    expect Some(bz) = list.at(list_vote_sign_bytes, idx)
                    bz
                  }
                  None -> vote.vote_sign_bytes_for_commit(commit, chain_id, idx)
                }

              expect
                builtin.verify_ed25519_signature(
                  val.pubkey,
                  vote_sign_bytes,
                  commit_sig.signature,
                )

              let new_tallied_voting_power =
                if count_sig(commit_sig) {
                  acc.1st + val.voting_power
                } else {
                  acc.1st
                }

              if
              !count_all_signatures && new_tallied_voting_power > voting_power_needed{
              
                (new_tallied_voting_power, seen_vals, True)
              } else {
                (new_tallied_voting_power, seen_vals, False)
              }
            }
            None -> acc
          }
        }
      },
    )

  partial_passed || tallied_voting_power > voting_power_needed
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
