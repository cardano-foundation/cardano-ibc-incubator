use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey_Ed25519,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/validator_pb.{
  SimpleValidator,
}

pub type Validator {
  address: ByteArray,
  pubkey: ByteArray,
  voting_power: Int,
  proposer_priority: Int,
}

pub fn bytes(v: Validator) -> ByteArray {
  let pbv =
    SimpleValidator {
      pub_key: Some(PublicKey_Ed25519 { sum: v.pubkey }),
      voting_power: v.voting_power,
    }
  validator_pb.marshal_for_simple_validator(Some(pbv))
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
