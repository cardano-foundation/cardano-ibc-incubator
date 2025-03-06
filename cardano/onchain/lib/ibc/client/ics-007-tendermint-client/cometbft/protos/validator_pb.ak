// DO NOT EDIT.
// source: tendermint/types/validator.proto

use ibc/client/ics_007_tendermint_client/cometbft/protos/keys_pb.{
  PublicKey, marshal_for_public_key_v2,
}
use ibc/utils/bytes.{add_and_concat, encode_int, nest_record}
use ibc/utils/int.{Int64}

pub type SimpleValidator {
  pub_key: PublicKey,
  voting_power: Int64,
}

pub fn marshal_for_simple_validator(sv: SimpleValidator) -> (Int, ByteArray) {
  let SimpleValidator { pub_key, voting_power } = sv
  (0, #"")
    |> add_and_concat(nest_record(marshal_for_public_key_v2(pub_key), 10))
    |> add_and_concat(encode_int(voting_power, 0x10))
}
