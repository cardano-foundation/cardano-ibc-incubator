use aiken/builtin
use aiken/collection/list
use aiken/math/rational.{Rational}
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/vote

type IndexedValidator {
  trusted_validator: Validator,
  seen_bit: Int,
}

type ValidatorIndex {
  EmptyValidatorIndex
  ValidatorIndexNode {
    left: ValidatorIndex,
    entry: IndexedValidator,
    right: ValidatorIndex,
  }
}

/// Verify that strictly more than `trust_level` of a trusted validator set
/// signed `commit`.
///
/// Building the balanced address index is O(v log v); each committing slot
/// then uses O(log v) lookup. Commit order, reverse fold short-circuiting,
/// absent/nil handling, first-address matching, and strict `>` are unchanged.
pub fn verify_commit_light_trusting(
  chain_id: ByteArray,
  vals: ValidatorSet,
  commit: Commit,
  trust_level: Rational,
  cached_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  expect !list.is_empty(vals.validators)
  expect rational.denominator(trust_level) != 0
  expect !list.is_empty(commit.signatures)

  let
    validator_index,
    total_voting_power,
  <- make_validator_index(vals.validators)
  let voting_power_needed =
    total_voting_power * rational.numerator(trust_level) / rational.denominator(
      trust_level,
    )
  let
    tallied_voting_power,
    _seen_bits,
    partial_passed,
  <-
    verify_commit_signatures(
      chain_id,
      commit,
      validator_index,
      voting_power_needed,
      commit.signatures,
      cached_vote_sign_bytes,
    )
  partial_passed || tallied_voting_power > voting_power_needed
}

fn index_validators(
  validators: List<Validator>,
  seen_bit: Int,
  return: fn(List<IndexedValidator>, Int, Int) -> result,
) -> result {
  when validators is {
    [] -> return([], 0, 0)
    [trusted_val, ..rest] -> {
      let
        indexed_rest,
        total_voting_power,
        count,
      <- index_validators(rest, seen_bit * 2)
      return(
        [
          IndexedValidator { trusted_validator: trusted_val, seen_bit },
          ..indexed_rest
        ],
        trusted_val.voting_power + total_voting_power,
        count + 1,
      )
    }
  }
}

fn make_validator_index(
  validators: List<Validator>,
  return: fn(ValidatorIndex, Int) -> result,
) -> result {
  let
    indexed_validators,
    total_voting_power,
    validator_count,
  <- index_validators(validators, 1)
  let sorted = sort_indexed_validators(indexed_validators, validator_count)
  let
    validator_index,
    remaining,
  <- validator_index_from_sorted(sorted, validator_count)
  expect list.is_empty(remaining)
  return(validator_index, total_voting_power)
}

/// Build a height-balanced tree in one pass over sorted entries. Returning the
/// unused suffix avoids repeated list indexing/splitting.
fn validator_index_from_sorted(
  entries: List<IndexedValidator>,
  count: Int,
  return: fn(ValidatorIndex, List<IndexedValidator>) -> result,
) -> result {
  if count <= 0 {
    return(EmptyValidatorIndex, entries)
  } else {
    let left_count = count / 2
    let left, after_left <- validator_index_from_sorted(entries, left_count)
    expect [entry, ..after_entry] = after_left
    let
      right,
      remaining,
    <- validator_index_from_sorted(after_entry, count - left_count - 1)
    return(ValidatorIndexNode { left, entry, right }, remaining)
  }
}

/// On duplicate trusted addresses, return the first entry in original wire
/// order just like the previous `list.find` implementation.
fn lookup_validator(
  validator_index: ValidatorIndex,
  address: ByteArray,
) -> Option<IndexedValidator> {
  when validator_index is {
    EmptyValidatorIndex -> None
    ValidatorIndexNode { left, entry, right } ->
      when bytearray.compare(address, entry.trusted_validator.address) is {
        Less -> lookup_validator(left, address)
        Greater -> lookup_validator(right, address)
        Equal ->
          when lookup_validator(left, address) is {
            Some(earlier) -> Some(earlier)
            None -> Some(entry)
          }
      }
  }
}

/// Right recursion processes the tail first, exactly like the previous
/// `indexed_foldr`, without first allocating a second signature list.
fn verify_commit_signatures(
  chain_id: ByteArray,
  commit: Commit,
  validator_index: ValidatorIndex,
  voting_power_needed: Int,
  signatures: List<CommitSig>,
  cached_vote_sign_bytes: Option<List<ByteArray>>,
  return: fn(Int, Int, Bool) -> result,
) -> result {
  when signatures is {
    [] -> return(0, 0, False)
    [commit_sig, ..rest] -> {
      // Consume supplied cache entries over every slot for index alignment.
      // Missing bytes matter only for a matched commit reached before quorum.
      let (cached_for_this_signature, remaining_cache) =
        when cached_vote_sign_bytes is {
          Some(bytes) ->
            when bytes is {
              [] -> (None, Some([]))
              [first, ..remaining] -> (Some(first), Some(remaining))
            }
          None -> (None, None)
        }
      let
        tallied_voting_power,
        seen_bits,
        partial_passed,
      <-
        verify_commit_signatures(
          chain_id,
          commit,
          validator_index,
          voting_power_needed,
          rest,
          remaining_cache,
        )

      if commit_sig.block_id_flag != block_id_flag_commit || partial_passed {
        return(tallied_voting_power, seen_bits, partial_passed)
      } else {
        when
          lookup_validator(validator_index, commit_sig.validator_address)
        is {
          None -> return(tallied_voting_power, seen_bits, partial_passed)
          Some(indexed_val) -> {
            expect seen_bits / indexed_val.seen_bit % 2 == 0

            let vote_sign_bytes =
              when cached_for_this_signature is {
                Some(bytes) -> bytes
                None ->
                  when cached_vote_sign_bytes is {
                    Some(_) -> fail
                    None ->
                      vote.vote_sign_bytes_for_commit_sig(
                        commit,
                        chain_id,
                        commit_sig,
                      )
                  }
              }

            expect
              builtin.verify_ed25519_signature(
                indexed_val.trusted_validator.pubkey,
                vote_sign_bytes,
                commit_sig.signature,
              )

            let new_tallied_voting_power =
              tallied_voting_power + indexed_val.trusted_validator.voting_power
            let new_seen_bits = seen_bits + indexed_val.seen_bit

            if new_tallied_voting_power > voting_power_needed {
              return(new_tallied_voting_power, new_seen_bits, True)
            } else {
              return(new_tallied_voting_power, new_seen_bits, False)
            }
          }
        }
      }
    }
  }
}

fn compare_indexed_validators(
  left: IndexedValidator,
  right: IndexedValidator,
) -> Ordering {
  bytearray.compare(
    left.trusted_validator.address,
    right.trusted_validator.address,
  )
}

/// Keep index construction O(v log v). Stdlib `list.sort` is insertion sort.
fn sort_indexed_validators(
  items: List<IndexedValidator>,
  count: Int,
) -> List<IndexedValidator> {
  if count <= 1 {
    items
  } else {
    let left_count = count / 2
    let (left, right) = list.span(items, left_count)
    merge_indexed_validators(
      sort_indexed_validators(left, left_count),
      sort_indexed_validators(right, count - left_count),
    )
  }
}

fn merge_indexed_validators(
  left: List<IndexedValidator>,
  right: List<IndexedValidator>,
) -> List<IndexedValidator> {
  when left is {
    [] -> right
    [left_head, ..left_tail] ->
      when right is {
        [] -> left
        [right_head, ..right_tail] ->
          if compare_indexed_validators(left_head, right_head) == Greater {
            [right_head, ..merge_indexed_validators(left, right_tail)]
          } else {
            [left_head, ..merge_indexed_validators(left_tail, right)]
          }
      }
  }
}
