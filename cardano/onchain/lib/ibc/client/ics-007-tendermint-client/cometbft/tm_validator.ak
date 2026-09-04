use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey_Ed25519,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/validator_pb.{
  SimpleValidator,
}

/// Largest value representable by CometBFT's signed 64-bit voting power.
pub const max_voting_power = 9223372036854775807

pub type Validator {
  address: ByteArray,
  pubkey: ByteArray,
  voting_power: Int,
  proposer_priority: Int,
}

/// Validate the wire fields used to hash and authenticate an Ed25519 validator.
/// Aiken integers are unbounded, so the signed 64-bit voting-power constraint
/// enforced by CometBFT must be checked explicitly before protobuf encoding.
pub fn validate_basic(v: Validator) -> Bool {
  and {
    bytearray.length(v.address) == 20,
    bytearray.length(v.pubkey) == 32,
    v.voting_power >= 0,
    v.voting_power <= max_voting_power,
  }
}

pub fn bytes(v: Validator) -> ByteArray {
  let pbv =
    SimpleValidator {
      pub_key: PublicKey_Ed25519 { sum: v.pubkey },
      voting_power: v.voting_power,
    }
  validator_pb.marshal_for_simple_validator(pbv).2nd
}

pub fn null_validator() -> Validator {
  Validator { address: "", pubkey: "", voting_power: 0, proposer_priority: 0 }
}

pub fn is_equal(v1: Validator, v2: Validator) -> Bool {
  if bytearray.compare(v1.address, v2.address) == Equal && bytearray.compare(
    v1.pubkey,
    v2.pubkey,
  ) == Equal && v1.voting_power == v1.voting_power && v1.proposer_priority == v1.proposer_priority {
    True
  } else {
    False
  }
}

//--------------------------------------Test--------------------------------------

test test_validator_bytes_function() {
  let val =
    Validator {
      address: #"4ae76aed128636dad8c84f814aff2b5b965a8001",
      pubkey: #"6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70",
      voting_power: 1,
      proposer_priority: 0,
    }
  bytes(val) == #"0a220a206210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed701001"
}

test validate_basic_accepts_voting_power_bounds() {
  let val =
    Validator {
      address: #"4ae76aed128636dad8c84f814aff2b5b965a8001",
      pubkey: #"6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70",
      voting_power: 0,
      proposer_priority: 0,
    }

  validate_basic(val) && validate_basic(
    Validator { ..val, voting_power: max_voting_power },
  )
}

test validate_basic_rejects_invalid_wire_fields() {
  let val =
    Validator {
      address: #"4ae76aed128636dad8c84f814aff2b5b965a8001",
      pubkey: #"6210fc94ff775add5fb919f1abbf9eb94aab6c345c334a035f3d4f2ea485ed70",
      voting_power: 1,
      proposer_priority: 0,
    }

  and {
    !validate_basic(Validator { ..val, address: #"4ae76aed" }),
    !validate_basic(Validator { ..val, pubkey: #"6210fc94" }),
    !validate_basic(Validator { ..val, voting_power: -1 }),
    !validate_basic(Validator { ..val, voting_power: max_voting_power + 1 }),
  }
}
