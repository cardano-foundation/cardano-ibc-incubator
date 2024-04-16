// DO NOT EDIT.
// source: ibc/core/connection/v1/connection.proto

use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/bytearray.{concat, length, push}
use aiken/list
use aiken/option.{is_none}
use ibc/client/ics_007_tendermint_client/cometbft/protos/commitment_pb.{
  marshal_for_merkle_prefix, size_for_merkle_prefix,
}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/utils/bytes.{encode_varint, sov}
use ibc/utils/int.{Int32, Uint64, uint64}

pub type State {
  UNINITIALIZED
  INIT
  TRYOPEN
  OPEN
}

pub type ConnectionEnd {
  client_id: ByteArray,
  versions: List<Option<Version>>,
  state: State,
  counterparty: Counterparty,
  delay_period: Uint64,
}

pub fn state_to_int32(state: State) -> Int32 {
  when state is {
    UNINITIALIZED -> 0
    INIT -> 1
    TRYOPEN -> 2
    OPEN -> 3
  }
}

pub fn marshal_for_version(version_opt: Option<Version>) -> ByteArray {
  ite(
    is_none(version_opt),
    #[],
    {
      expect Some(version) = version_opt
      let Version { identifier, features } = version
      #[]
        |> concat(
             ite(
               length(identifier) == 0,
               #[],
               {
                 let l = length(identifier)
                 l
                   |> uint64()
                   |> encode_varint()
                   |> concat(identifier)
                   |> push(10)
               },
             ),
           )
        |> concat(
             ite(
               list.length(features) == 0,
               #[],
               features
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, feature: ByteArray) -> ByteArray {
                        bz
                          |> concat(
                               feature
                                 |> length()
                                 |> uint64()
                                 |> encode_varint()
                                 |> concat(feature)
                                 |> push(0x12),
                             )
                      },
                    ),
             ),
           )
    },
  )
}

fn size_for_version(version_opt: Option<Version>) -> Int {
  ite(
    is_none(version_opt),
    0,
    {
      expect Some(version) = version_opt
      let Version { identifier, features } = version
      0
        |> add(
             ite(
               length(identifier) == 0,
               0,
               {
                 let l = length(identifier)
                 l |> uint64() |> sov() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               list.length(features) == 0,
               0,
               features
                 |> list.reduce(
                      0,
                      fn(sz: Int, feature: ByteArray) -> Int {
                        let l = length(feature)
                        l
                          |> uint64()
                          |> sov()
                          |> add(l + 1 + sz)
                      },
                    ),
             ),
           )
    },
  )
}

pub fn marshal_for_counterparty(
  counterparty_opt: Option<Counterparty>,
) -> ByteArray {
  ite(
    is_none(counterparty_opt),
    #[],
    {
      expect Some(counterparty) = counterparty_opt
      let Counterparty { client_id, connection_id, prefix } = counterparty
      #[]
        |> concat(
             ite(
               length(client_id) == 0,
               #[],
               client_id
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(client_id)
                 |> push(10),
             ),
           )
        |> concat(
             ite(
               length(connection_id) == 0,
               #[],
               connection_id
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(connection_id)
                 |> push(0x12),
             ),
           )
        |> concat(
             prefix
               |> Some()
               |> size_for_merkle_prefix()
               |> uint64()
               |> encode_varint()
               |> concat(marshal_for_merkle_prefix(Some(prefix)))
               |> push(0x1a),
           )
    },
  )
}

pub fn size_for_counterparty(counterparty_opt: Option<Counterparty>) -> Int {
  ite(
    is_none(counterparty_opt),
    0,
    {
      expect Some(counterparty) = counterparty_opt
      let Counterparty { client_id, connection_id, prefix } = counterparty
      0
        |> add(
             ite(
               length(client_id) == 0,
               0,
               {
                 let l = length(client_id)
                 l |> uint64() |> sov() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(connection_id) == 0,
               0,
               {
                 let l = length(connection_id)
                 l |> uint64() |> sov() |> add(l + 1)
               },
             ),
           )
        |> add(
             {
               let l = size_for_merkle_prefix(Some(prefix))
               l |> uint64() |> sov() |> add(l + 1)
             },
           )
    },
  )
}

pub fn marshal_for_connection_end(
  connection_end_opt: Option<ConnectionEnd>,
) -> ByteArray {
  ite(
    is_none(connection_end_opt),
    #[],
    {
      expect Some(connection_end) = connection_end_opt
      let ConnectionEnd {
        client_id,
        versions,
        state,
        counterparty,
        delay_period,
      } = connection_end
      #[]
        |> concat(
             ite(
               length(client_id) == 0,
               #[],
               client_id
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(client_id)
                 |> push(10),
             ),
           )
        |> concat(
             ite(
               list.length(versions) == 0,
               #[],
               versions
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, version_opt: Option<Version>) -> ByteArray {
                        bz
                          |> concat(
                               version_opt
                                 |> size_for_version()
                                 |> uint64()
                                 |> encode_varint()
                                 |> concat(marshal_for_version(version_opt))
                                 |> push(0x12),
                             )
                      },
                    ),
             ),
           )
        |> concat(
             ite(
               state_to_int32(state) == 0,
               #[],
               state
                 |> state_to_int32()
                 |> uint64()
                 |> encode_varint()
                 |> push(0x18),
             ),
           )
        |> concat(
             counterparty
               |> Some()
               |> size_for_counterparty()
               |> uint64()
               |> encode_varint()
               |> concat(marshal_for_counterparty(Some(counterparty)))
               |> push(0x22),
           )
        |> concat(
             ite(
               delay_period == 0,
               #[],
               delay_period
                 |> uint64()
                 |> encode_varint()
                 |> push(0x28),
             ),
           )
    },
  )
}

pub fn size_for_connection_end(connection_end_opt: Option<ConnectionEnd>) -> Int {
  ite(
    is_none(connection_end_opt),
    0,
    {
      expect Some(connection_end) = connection_end_opt
      let ConnectionEnd {
        client_id,
        versions,
        state,
        counterparty,
        delay_period,
      } = connection_end
      0
        |> add(
             ite(
               length(client_id) == 0,
               0,
               {
                 let l = length(client_id)
                 l |> uint64() |> sov() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               list.length(versions) == 0,
               0,
               versions
                 |> list.reduce(
                      0,
                      fn(sz: Int, version: Option<Version>) -> Int {
                        sz
                          |> add(
                               {
                                 let l = size_for_version(version)
                                 l
                                   |> uint64()
                                   |> sov()
                                   |> add(l + 1)
                               },
                             )
                      },
                    ),
             ),
           )
        |> add(
             ite(
               state_to_int32(state) == 0,
               0,
               state
                 |> state_to_int32()
                 |> uint64()
                 |> sov()
                 |> add(1),
             ),
           )
        |> add(
             {
               let l = counterparty |> Some() |> size_for_counterparty()
               l |> uint64() |> sov() |> add(l + 1)
             },
           )
        |> add(
             ite(
               delay_period == 0,
               0,
               delay_period |> uint64() |> sov() |> add(1),
             ),
           )
    },
  )
}
