use aiken/builtin
use aiken/collection/list
use aiken/math/rational.{Rational}
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit, precommit_type,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/vote.{Vote}

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

  let voting_power_needed =
    validator_set.total_voting_power(vals) * rational.numerator(trust_level) / rational.denominator(
      trust_level,
    )
  let validator_index = make_validator_index(vals.validators)
  let (tallied_voting_power, _seen_bits, partial_passed) =
    verify_commit_signatures(
      chain_id,
      commit,
      validator_index,
      voting_power_needed,
      commit.signatures,
      cached_vote_sign_bytes,
      0,
    )

  partial_passed || tallied_voting_power > voting_power_needed
}

fn index_validators(
  validators: List<Validator>,
  seen_bit: Int,
) -> List<IndexedValidator> {
  when validators is {
    [] -> []
    [trusted_val, ..rest] ->
      [
        IndexedValidator { trusted_validator: trusted_val, seen_bit },
        ..index_validators(rest, seen_bit * 2)
      ]
  }
}

fn make_validator_index(validators: List<Validator>) -> ValidatorIndex {
  let validator_count = list.length(validators)
  let sorted =
    validators
      |> index_validators(1)
      |> merge_sort(validator_count, compare_indexed_validators)
  let (validator_index, remaining) =
    validator_index_from_sorted(sorted, list.length(sorted))
  expect list.is_empty(remaining)
  validator_index
}

/// Build a height-balanced tree in one pass over sorted entries. Returning the
/// unused suffix avoids repeated list indexing/splitting.
fn validator_index_from_sorted(
  entries: List<IndexedValidator>,
  count: Int,
) -> (ValidatorIndex, List<IndexedValidator>) {
  if count <= 0 {
    (EmptyValidatorIndex, entries)
  } else {
    let left_count = count / 2
    let (left, after_left) = validator_index_from_sorted(entries, left_count)
    expect [entry, ..after_entry] = after_left
    let (right, remaining) =
      validator_index_from_sorted(after_entry, count - left_count - 1)
    (ValidatorIndexNode { left, entry, right }, remaining)
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
  original_index: Int,
) -> (Int, Int, Bool) {
  when signatures is {
    [] -> (0, 0, False)
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
      let acc =
        verify_commit_signatures(
          chain_id,
          commit,
          validator_index,
          voting_power_needed,
          rest,
          remaining_cache,
          original_index + 1,
        )

      if commit_sig.block_id_flag != block_id_flag_commit || acc.3rd {
        acc
      } else {
        when
          lookup_validator(validator_index, commit_sig.validator_address)
        is {
          None -> acc
          Some(indexed_val) -> {
            expect acc.2nd / indexed_val.seen_bit % 2 == 0

            let vote_sign_bytes =
              when cached_for_this_signature is {
                Some(bytes) -> bytes
                None ->
                  when cached_vote_sign_bytes is {
                    Some(_) -> fail
                    None ->
                      vote_sign_bytes_for_commit_sig(
                        commit,
                        chain_id,
                        original_index,
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
              acc.1st + indexed_val.trusted_validator.voting_power
            let new_seen_bits = acc.2nd + indexed_val.seen_bit

            if new_tallied_voting_power > voting_power_needed {
              (new_tallied_voting_power, new_seen_bits, True)
            } else {
              (new_tallied_voting_power, new_seen_bits, False)
            }
          }
        }
      }
    }
  }
}

// The adjacent-verification patch exposes the same construction in `vote.ak`;
// integration can replace this local helper without changing the index.
fn vote_sign_bytes_for_commit_sig(
  commit: Commit,
  chain_id: ByteArray,
  validator_position: Int,
  commit_sig: CommitSig,
) -> ByteArray {
  vote.vote_sign_bytes(
    chain_id,
    Vote {
      vote_type: precommit_type,
      height: commit.height,
      round: commit.round,
      block_id: commit.block_id,
      timestamp: commit_sig.timestamp,
      validator_address: commit_sig.validator_address,
      validator_index: validator_position,
      signature: commit_sig.signature,
      extension: #"",
      extension_signature: #"",
    },
  )
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

/// Stdlib `list.sort` is insertion sort. This stable merge sort splits
/// contiguous halves so equal addresses retain original wire order.
fn merge_sort(
  items: List<a>,
  count: Int,
  compare: fn(a, a) -> Ordering,
) -> List<a> {
  if count <= 1 {
    items
  } else {
    let left_count = count / 2
    let (left, right) = list.span(items, left_count)
    merge_sorted(
      merge_sort(left, left_count, compare),
      merge_sort(right, count - left_count, compare),
      compare,
    )
  }
}

fn merge_sorted(
  left: List<a>,
  right: List<a>,
  compare: fn(a, a) -> Ordering,
) -> List<a> {
  when left is {
    [] -> right
    [left_head, ..left_tail] ->
      when right is {
        [] -> left
        [right_head, ..right_tail] ->
          if compare(left_head, right_head) == Greater {
            [right_head, ..merge_sorted(left, right_tail, compare)]
          } else {
            [left_head, ..merge_sorted(left_tail, right, compare)]
          }
      }
  }
}
