use aiken/bytearray

pub type Validator {
  address: ByteArray,
  pubkey: ByteArray,
  voting_power: Int,
  proposer_priority: Int,
}

pub fn bytes() -> ByteArray {
  todo
}

pub fn null_validator() -> Validator {
  Validator { address: "", pubkey: "", voting_power: 0, proposer_priority: 0 }
}

pub fn is_equal(v1: Validator, v2: Validator) -> Bool {
  if
  bytearray.compare(v1.address, v2.address) == Equal && bytearray.compare(
    v1.pubkey,
    v2.pubkey,
  ) == Equal && v1.voting_power == v1.voting_power && v1.proposer_priority == v1.proposer_priority{
  
    True
  } else {
    False
  }
}
