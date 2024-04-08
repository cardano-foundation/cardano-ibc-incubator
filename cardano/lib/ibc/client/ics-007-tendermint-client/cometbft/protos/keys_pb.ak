// DO NOT EDIT.
// source: tendermint/crypto/keys.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, length, push}
use aiken/option.{is_none}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int64, uint64}

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
      expect PublicKey_Ed25519(sum) = pk
      #[]
        |> concat(
             ite(
               length(sum) == 0,
               #[],
               sum
                 |> length()
                 |> uint64()
                 |> encode_varint_keys()
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
      expect PublicKey_Ed25519(sum) = pk
      ite(
        length(sum) == 0,
        0,
        {
          let l = length(sum)
          l |> uint64() |> sov_keys() |> add(l + 1)
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
      expect PublicKey_Secp256K1(sum) = pk
      #[]
        |> concat(
             ite(
               length(sum) == 0,
               #[],
               sum
                 |> length()
                 |> uint64()
                 |> encode_varint_keys()
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
      expect PublicKey_Secp256K1(sum) = pk
      ite(
        length(sum) == 0,
        0,
        {
          let l = length(sum)
          l |> uint64() |> sov_keys() |> add(l + 1)
        },
      )
    },
  )
}

fn sov_keys(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}

fn encode_varint_keys(v: Int64) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_keys()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}
