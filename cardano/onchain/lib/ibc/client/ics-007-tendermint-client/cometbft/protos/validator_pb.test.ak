use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey_Ed25519, PublicKey_Secp256K1,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/validator_pb.{
  SimpleValidator, marshal_for_simple_validator,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/validator_pb_deprecated.{
  SimpleValidator as SimpleValidatorDeprecated,
  marshal_for_simple_validator as marshal_for_simple_validator_deprecated,
  size_for_simple_validator as size_for_simple_validator_deprecated,
}

test marshal_for_simple_validator_01() {
  let pb =
    SimpleValidatorDeprecated {
      pub_key: Some(PublicKey_Ed25519 { sum: #[1, 2, 3] }),
      voting_power: 67,
    }
  marshal_for_simple_validator_deprecated(Some(pb)) == #"0a050a030102031043"
}

test marshal_for_simple_validator_same_result_empty() {
  let pb =
    SimpleValidatorDeprecated {
      pub_key: Some(PublicKey_Secp256K1 { sum: #"" }),
      voting_power: 0,
    }
  let pb_v2 =
    SimpleValidator {
      pub_key: PublicKey_Secp256K1 { sum: #"" },
      voting_power: 0,
    }
  let (length, bytes) = marshal_for_simple_validator(pb_v2)
  let length_deprecated = size_for_simple_validator_deprecated(Some(pb))
  let bytes_deprecated = marshal_for_simple_validator_deprecated(Some(pb))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test marshal_for_simple_validator_same_result() {
  let pb =
    SimpleValidatorDeprecated {
      pub_key: Some(PublicKey_Secp256K1 { sum: #[7, 8, 9] }),
      voting_power: 27,
    }
  let pb_v2 =
    SimpleValidator {
      pub_key: PublicKey_Secp256K1 { sum: #[7, 8, 9] },
      voting_power: 27,
    }
  let (length, bytes) = marshal_for_simple_validator(pb_v2)
  let length_deprecated = size_for_simple_validator_deprecated(Some(pb))
  let bytes_deprecated = marshal_for_simple_validator_deprecated(Some(pb))

  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}
