use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}

pub type ValidatorSet {
  validators: List<Validator>,
  proposer: Validator,
  total_voting_power: Int,
}

pub fn hash(vals: ValidatorSet) -> ByteArray {
  let bzs = list.map(vals.validators, fn(val) { tm_validator.bytes(val) })
  tree.hash_from_byte_slices_sha2_256(bzs)
}

pub fn null_validator_set() -> ValidatorSet {
  ValidatorSet {
    validators: [],
    proposer: tm_validator.null_validator(),
    total_voting_power: 0,
  }
}

/// Derive total voting power from the validator entries committed by the
/// validator-set hash. The relayed aggregate is never a source of truth.
pub fn total_voting_power(vals: ValidatorSet) -> Int {
  list.reduce(vals.validators, 0, fn(acc, val) { acc + val.voting_power })
}

pub fn size(vals: ValidatorSet) -> Int {
  list.length(vals.validators)
}

pub fn get_by_address(
  vals: ValidatorSet,
  address: ByteArray,
) -> Option<Validator> {
  list.find(vals.validators, fn(val) { val.address == address })
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

test test_validator_set_hash_45_validators() {
  let val =
    Validator {
      address: #"4ae76aed128636dad8c84f814aff2b5b965a8001",
      pubkey: #"6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70",
      voting_power: 1,
      proposer_priority: 0,
    }
  let validators = list.repeat(val, 45)
  hash(ValidatorSet { validators, proposer: val, total_voting_power: 45 }) == #"4580cb4ea9e7f279f54ee772a718e14d4ce151e6f3ccd63a40a710d033e40c50"
}

test test_validator_set_hash_preserves_validator_order() {
  let first =
    Validator {
      address: #"4ae76aed128636dad8c84f814aff2b5b965a8001",
      pubkey: #"6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70",
      voting_power: 1,
      proposer_priority: 0,
    }
  let second =
    Validator {
      ..first,
      pubkey: #"1111111111111111111111111111111111111111111111111111111111111111",
      voting_power: 2,
    }
  let third =
    Validator {
      ..first,
      pubkey: #"2222222222222222222222222222222222222222222222222222222222222222",
      voting_power: 3,
    }
  hash(
    ValidatorSet {
      validators: [first, second, third],
      proposer: first,
      total_voting_power: 6,
    },
  ) == #"500249413fdf36a335aaff208b52143098232aa3f9a2bef0964c026107ec5e38"
}
