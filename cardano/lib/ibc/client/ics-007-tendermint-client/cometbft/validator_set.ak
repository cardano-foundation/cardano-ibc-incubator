use aiken/bytearray
use aiken/list
use aiken/option
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}

pub type ValidatorSet {
  validators: List<Validator>,
  proposer: Validator,
  total_voting_power: Int,
}

pub fn hash(_vals: ValidatorSet) -> ByteArray {
  todo
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
  vals.total_voting_power
}

pub fn size(vals: ValidatorSet) -> Int {
  list.length(vals.validators)
}

pub fn get_by_address(
  vals: ValidatorSet,
  address: ByteArray,
) -> (Int, Validator) {
  let tm_validator =
    list.find(
      vals.validators,
      fn(val) { bytearray.compare(val.address, address) == Equal },
    )
  if option.is_none(tm_validator) {
    (-1, tm_validator.null_validator())
  } else {
    let founded_validator =
      option.or_else(tm_validator, tm_validator.null_validator())
    expect Some(index) = list.index_of(vals.validators, founded_validator)
    (index, founded_validator)
  }
}
