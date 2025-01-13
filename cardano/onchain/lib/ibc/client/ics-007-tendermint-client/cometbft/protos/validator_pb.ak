// DO NOT EDIT.
// source: tendermint/types/validator.proto

use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey, marshal_for_public_key, size_for_public_key,
}
use ibc/utils/bytes.{encode_varint, sov}
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
                |> encode_varint()
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
                |> encode_varint()
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
                l |> uint64() |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              voting_power == 0,
              0,
              voting_power |> uint64() |> sov() |> add(1),
            ),
          )
    },
  )
}
