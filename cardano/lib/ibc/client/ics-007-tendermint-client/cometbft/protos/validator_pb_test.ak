use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey_Ed25519, PublicKey_Secp256K1,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/validator_pb.{
  SimpleValidator, marshal_for_simple_validator,
}

test marshal_for_simple_validator_01() {
  let pb =
    SimpleValidator {
      pub_key: Some(PublicKey_Ed25519 { sum: #[1, 2, 3] }),
      voting_power: 67,
    }
  marshal_for_simple_validator(Some(pb)) == #"0a050a030102031043"
}

test marshal_for_simple_validator_02() {
  let pb =
    SimpleValidator {
      pub_key: Some(PublicKey_Secp256K1 { sum: #[7, 8, 9] }),
      voting_power: 27,
    }
  marshal_for_simple_validator(Some(pb)) == #"0a051203070809101b"
}
