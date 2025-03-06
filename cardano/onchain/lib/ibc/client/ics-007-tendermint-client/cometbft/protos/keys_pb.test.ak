use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey_Ed25519, PublicKey_Secp256K1, marshal_for_public_key,
  marshal_for_public_key_v2, size_for_public_key,
}

test test_marshal_key_same_result_ed() {
  let key =
    PublicKey_Ed25519(
      #"a282f1d7db456bc3b5a4d2c412d4e0d573f7512e09052e19b380fc0336b7ff359bad1d1d4480906924",
    )
  let (length, bytes) = marshal_for_public_key_v2(key)
  let length_deprecated = size_for_public_key(Some(key))
  let bytes_deprecated = marshal_for_public_key(Some(key))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_key_same_result_secp() {
  let key =
    PublicKey_Secp256K1(
      #"a282f1d7db456bc3b5a4d2c412d4e0d573f7512e09052e19b380fc0336b7ff359bad1d1d4480906924",
    )
  let (length, bytes) = marshal_for_public_key_v2(key)
  let length_deprecated = size_for_public_key(Some(key))
  let bytes_deprecated = marshal_for_public_key(Some(key))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}
