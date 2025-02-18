use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/utils/bytes.{encode_varint, sov}

pub type PublicKey {
  PublicKey_Ed25519 { sum: ByteArray }
  PublicKey_Secp256K1 { sum: ByteArray }
}

pub fn marshal_for_public_key(pk_opt: Option<PublicKey>) -> ByteArray {
  ite(
    is_none(pk_opt),
    #[],
    {
      expect Some(pk) = pk_opt
      when pk is {
        PublicKey_Ed25519 { .. } -> marshal_for_ed25519(Some(pk))
        PublicKey_Secp256K1 { .. } -> marshal_for_secp256k1(Some(pk))
      }
    },
  )
}

pub fn size_for_public_key(pk_opt: Option<PublicKey>) -> Int {
  ite(
    is_none(pk_opt),
    0,
    {
      expect Some(pk) = pk_opt
      when pk is {
        PublicKey_Ed25519 { .. } -> size_for_ed25519(Some(pk))
        PublicKey_Secp256K1 { .. } -> size_for_secp256k1(Some(pk))
      }
    },
  )
}

pub fn marshal_for_ed25519(pk_opt: Option<PublicKey>) -> ByteArray {
  ite(
    is_none(pk_opt),
    #[],
    {
      expect Some(pk) = pk_opt
      expect PublicKey_Ed25519 { sum } = pk
      #[]
        |> concat(
            ite(
              length(sum) == 0,
              #[],
              sum
                |> length()
                |> encode_varint()
                |> concat(sum)
                |> push(10),
            ),
          )
    },
  )
}

pub fn size_for_ed25519(pk_opt: Option<PublicKey>) -> Int {
  ite(
    is_none(pk_opt),
    0,
    {
      expect Some(pk) = pk_opt
      expect PublicKey_Ed25519 { sum } = pk
      ite(
        length(sum) == 0,
        0,
        {
          let l = length(sum)
          l |> sov() |> add(l + 1)
        },
      )
    },
  )
}

pub fn marshal_for_secp256k1(pk_opt: Option<PublicKey>) -> ByteArray {
  ite(
    is_none(pk_opt),
    #[],
    {
      expect Some(pk) = pk_opt
      expect PublicKey_Secp256K1 { sum } = pk
      #[]
        |> concat(
            ite(
              length(sum) == 0,
              #[],
              sum
                |> length()
                |> encode_varint()
                |> concat(sum)
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn size_for_secp256k1(pk_opt: Option<PublicKey>) -> Int {
  ite(
    is_none(pk_opt),
    0,
    {
      expect Some(pk) = pk_opt
      expect PublicKey_Secp256K1 { sum } = pk
      ite(
        length(sum) == 0,
        0,
        {
          let l = length(sum)
          l |> sov() |> add(l + 1)
        },
      )
    },
  )
}
