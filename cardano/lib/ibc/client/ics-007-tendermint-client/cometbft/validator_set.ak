use aiken/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/utils/list as list_utils

pub type ValidatorSet {
  validators: List<Validator>,
  proposer: Validator,
  total_voting_power: Int,
}

pub fn hash(vals: ValidatorSet) -> ByteArray {
  let bzs =
    vals.validators
      |> list.reduce(
          [],
          fn(accum, val) { list.concat(accum, [tm_validator.bytes(val)]) },
        )
  tree.hash_from_byte_slices_sha2_256(bzs)
}

pub fn null_validator_set() -> ValidatorSet {
  ValidatorSet {
    validators: [],
    proposer: tm_validator.null_validator(),
    total_voting_power: 0,
  }
}

// TODO: Need recalculation of the set's total voting power 
// if current total_voting_power is 0
pub fn total_voting_power(vals: ValidatorSet) -> Int {
  if vals.total_voting_power == 0 {
    list.reduce(vals.validators, 0, fn(acc, val) { acc + val.voting_power })
  } else {
    vals.total_voting_power
  }
}

pub fn size(vals: ValidatorSet) -> Int {
  list.length(vals.validators)
}

pub fn get_by_address(
  vals: ValidatorSet,
  address: ByteArray,
) -> Option<(Int, Validator)> {
  list_utils.indexed_find(vals.validators, fn(val) { val.address == address })
}

//--------------------------------------Test--------------------------------------

test test_validator_set_hash_function() {
  expect
    hash(null_validator_set()) == #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  let not_null_validator_set =
    ValidatorSet {
      validators: [
        Validator {
          address: #"2e0cae787f6a5cfb001b59672c7562320c41a941",
          pubkey: #"bd78473ccf161dd59f3f2dcba23682a8fbf39e9fc68283feecfa36c2143b7ffd",
          voting_power: 383447660407194304,
          proposer_priority: 0,
        },
      ],
      proposer: Validator {
        address: #"2e0cae787f6a5cfb001b59672c7562320c41a941",
        pubkey: #"bd78473ccf161dd59f3f2dcba23682a8fbf39e9fc68283feecfa36c2143b7ffd",
        voting_power: 383447660407194304,
        proposer_priority: 0,
      },
      total_voting_power: 383447660407194304,
    }
  hash(not_null_validator_set) == #"f4317dc3e1d3989be7e6d9a687a6a903e1c0678d7122ed6e8f3af725a0726962"
}
