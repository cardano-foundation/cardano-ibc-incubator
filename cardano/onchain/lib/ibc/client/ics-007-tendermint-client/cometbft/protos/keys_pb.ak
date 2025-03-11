use ibc/utils/bytes.{encode_bytearray, size_and_concat}

pub type PublicKey {
  PublicKey_Ed25519 { sum: ByteArray }
  PublicKey_Secp256K1 { sum: ByteArray }
}

pub fn marshal_for_public_key(pk: PublicKey) -> (Int, ByteArray) {
  let (key, identifier) =
    when pk is {
      PublicKey_Ed25519 { sum } -> (sum, 10)
      PublicKey_Secp256K1 { sum } -> (sum, 0x12)
    }
  (0, #"")
    |> size_and_concat(encode_bytearray(key, identifier))
}
