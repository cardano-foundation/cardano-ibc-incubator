use aiken/builtin
use aiken/bytearray
use aiken/dict
use aiken/int
use aiken/list
use aiken/math/rational.{Rational}
use aiken/option
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{BlockID, Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/vote

pub fn verify_commit_light(
  chain_id: ByteArray,
  vals: ValidatorSet,
  block_id: BlockID,
  heght: Int,
  commit: Commit,
) -> Bool {
  verify_commit_light_internal(chain_id, vals, block_id, heght, commit, False)
}

fn verify_commit_light_internal(
  chain_id: ByteArray,
  vals: ValidatorSet,
  block_id: BlockID,
  height: Int,
  commit: Commit,
  count_all_signatures: Bool,
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
      count_all_signatures,
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
      count_all_signatures,
      True,
    )
  }
}

pub fn verify_commit_light_trusting(
  chain_id: ByteArray,
  vals: ValidatorSet,
  commit: Commit,
  trust_level: Rational,
) -> Bool {
  verify_commit_light_trusting_internal(
    chain_id,
    vals,
    commit,
    trust_level,
    False,
  )
}

fn verify_commit_light_trusting_internal(
  chain_id: ByteArray,
  vals: ValidatorSet,
  commit: Commit,
  trust_level: Rational,
  count_all_signatures: Bool,
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
      count_all_signatures,
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
      count_all_signatures,
      False,
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
  _count_all_signatures: Bool,
  lock_up_by_index: Bool,
) -> Bool {
  let (tallied_voting_power, _idx, _seen_vals) =
    list.reduce(
      commit.signatures,
      (0, 0, dict.new()),
      fn(accum, sig) {
        if ignore_sig(sig) {
          (accum.1st, accum.2nd + 1, accum.3rd)
        } else {
          expect commit_sig.validate_basic(sig)
          if lock_up_by_index {
            expect Some(val) = list.at(vals.validators, accum.2nd)
            expect !bytearray.is_empty(val.pubkey)
            let vote_sign_bytes =
              vote.vote_sign_bytes_for_commit(commit, chain_id, accum.2nd)
            expect
              builtin.verify_ed25519_signature(
                val.pubkey,
                vote_sign_bytes,
                sig.signature,
              )
            if count_sig(sig) {
              (accum.1st + val.voting_power, accum.2nd + 1, accum.3rd)
            } else {
              (accum.1st, accum.2nd + 1, accum.3rd)
            }
          } else {
            let (val_idx, val) =
              validator_set.get_by_address(vals, sig.validator_address)
            if tm_validator.is_equal(val, tm_validator.null_validator()) {
              (accum.1st, accum.2nd + 1, accum.3rd)
            } else {
              expect !bytearray.is_empty(val.pubkey)
              let vote_sign_bytes =
                vote.vote_sign_bytes_for_commit(commit, chain_id, accum.2nd)
              expect
                builtin.verify_ed25519_signature(
                  val.pubkey,
                  vote_sign_bytes,
                  sig.signature,
                )
              expect option.is_none(dict.get(accum.3rd, val_idx))
              if count_sig(sig) {
                (
                  accum.1st + val.voting_power,
                  accum.2nd + 1,
                  dict.insert(accum.3rd, val_idx, accum.2nd, int.compare),
                )
              } else {
                (
                  accum.1st,
                  accum.2nd + 1,
                  dict.insert(accum.3rd, val_idx, accum.2nd, int.compare),
                )
              }
            }
          }
        }
      },
    )
  expect tallied_voting_power > voting_power_needed
  True
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
