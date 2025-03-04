use aiken/builtin.{if_then_else as ite}
// DO NOT EDIT.
// source: ibc/core/connection/v1/connection.proto

use aiken/collection/list
use aiken/primitive/bytearray.{concat, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/commitment_pb.{
  marshal_for_merkle_prefix,
}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_length_varint, encode_varint,
  size_and_concat, sov_length,
}
use ibc/utils/int.{Int32, Uint64}

pub type State {
  UNINITIALIZED
  INIT
  TRYOPEN
  OPEN
}

pub type ConnectionEnd {
  client_id: ByteArray,
  versions: List<Version>,
  state: State,
  counterparty: Counterparty,
  delay_period: Uint64,
}

pub fn marshal_for_connection_end(connection_end: ConnectionEnd) -> ByteArray {
  let ConnectionEnd { client_id, versions, state, counterparty, delay_period } =
    connection_end
  #[]
    |> concat(
        {
          let (_, bz) = encode_bytearray(client_id, 10)
          bz
        },
      )
    |> concat(
        list.reduce(
          versions,
          #[],
          fn(bz1: ByteArray, version: Version) -> ByteArray {
            let (size, bz2) = marshal_for_version(version)
            bz1
              |> concat(
                  size
                    |> encode_length_varint()
                    |> concat(bz2)
                    |> push(0x12),
                )
          },
        ),
      )
    |> concat(
        {
          let int_state = state_to_int32(state)
          ite(
            int_state == 0,
            #[],
            int_state
              |> encode_varint()
              |> push(0x18),
          )
        },
      )
    |> concat(
        {
          let (size, bz) = marshal_for_counterparty(counterparty)
          size
            |> encode_length_varint()
            |> concat(bz)
            |> push(0x22)
        },
      )
    |> concat(
        ite(
          delay_period == 0,
          #[],
          delay_period
            |> encode_varint()
            |> push(0x28),
        ),
      )
}

pub fn state_to_int32(state: State) -> Int32 {
  when state is {
    UNINITIALIZED -> 0
    INIT -> 1
    TRYOPEN -> 2
    OPEN -> 3
  }
}

pub fn marshal_for_version(version: Version) -> (Int, ByteArray) {
  let Version { identifier, features } = version
  (0, #[])
    |> size_and_concat(encode_bytearray(identifier, 10))
    |> add_and_concat(
        list.reduce(
          features,
          (0, #[]),
          fn(acc, feature: ByteArray) -> (Int, ByteArray) {
            acc
              |> size_and_concat(encode_bytearray(feature, 0x12))
          },
        ),
      )
}

pub fn marshal_for_counterparty(counterparty: Counterparty) -> (Int, ByteArray) {
  let Counterparty { client_id, connection_id, prefix } = counterparty
  (0, #[])
    |> size_and_concat(encode_bytearray(client_id, 10))
    |> size_and_concat(encode_bytearray(connection_id, 0x12))
    |> add_and_concat(
        {
          let (size, bz1) = marshal_for_merkle_prefix(prefix)
          let bz2 =
            size
              |> encode_length_varint()
              |> concat(bz1)
              |> push(0x1a)
          (sov_length(size) + size + 1, bz2)
        },
      )
}
