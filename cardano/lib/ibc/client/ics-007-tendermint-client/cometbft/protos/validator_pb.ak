// DO NOT EDIT.
// source: tendermint/types/validator.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, push}
use aiken/option.{is_none}
use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey, marshal_for_public_key, size_for_public_key,
}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int64, uint64}

pub type SimpleValidator {
  pub_key: Option<PublicKey>,
  voting_power: Int64,
}

pub fn marshal_for_simple_validator(
  sv_opt: Option<SimpleValidator>,
) -> ByteArray {
  ite(
    is_none(sv_opt),
    #[],
    {
      expect Some(sv) = sv_opt
      let SimpleValidator { pub_key, voting_power } = sv
      #[]
        |> concat(
             ite(
               is_none(pub_key),
               #[],
               pub_key
                 |> size_for_public_key()
                 |> uint64()
                 |> encode_varint_validator()
                 |> concat(marshal_for_public_key(pub_key))
                 |> push(10),
             ),
           )
        |> concat(
             ite(
               voting_power == 0,
               #[],
               voting_power
                 |> uint64()
                 |> encode_varint_validator()
                 |> push(0x10),
             ),
           )
    },
  )
}

pub fn size_for_simple_validator(sv_opt: Option<SimpleValidator>) -> Int {
  ite(
    is_none(sv_opt),
    0,
    {
      expect Some(sv) = sv_opt
      let SimpleValidator { pub_key, voting_power } = sv
      0
        |> add(
             ite(
               is_none(pub_key),
               0,
               {
                 let l = size_for_public_key(pub_key)
                 l |> uint64() |> sov_validator() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               voting_power == 0,
               0,
               voting_power |> uint64() |> sov_validator() |> add(1),
             ),
           )
    },
  )
}

fn sov_validator(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}

fn encode_varint_validator(v: Int64) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_validator()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}
