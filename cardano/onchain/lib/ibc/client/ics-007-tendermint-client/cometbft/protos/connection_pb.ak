use aiken/builtin.{add_integer as add, if_then_else as ite}
// DO NOT EDIT.
// source: ibc/core/connection/v1/connection.proto

use aiken/collection/list
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/commitment_pb.{
  marshal_for_merkle_prefix, size_for_merkle_prefix,
}
use ibc/core/ics_003_connection_semantics/types/counterparty.{
  Counterparty, new_counterparty,
}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
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
                  |> encode_varint()
                  |> concat(identifier)
                  |> push(10)
              },
            ),
          )
        |> concat(
            ite(
              list.is_empty(features),
              #[],
              features
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, feature: ByteArray) -> ByteArray {
                      bz
                        |> concat(
                            feature
                              |> length()
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
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              list.is_empty(features),
              0,
              features
                |> list.reduce(
                    0,
                    fn(sz: Int, feature: ByteArray) -> Int {
                      let l = length(feature)
                      l
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
                |> encode_varint()
                |> concat(connection_id)
                |> push(0x12),
            ),
          )
        |> concat(
            prefix
              |> Some()
              |> size_for_merkle_prefix()
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
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(connection_id) == 0,
              0,
              {
                let l = length(connection_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            {
              let l = size_for_merkle_prefix(Some(prefix))
              l |> sov() |> add(l + 1)
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
                |> encode_varint()
                |> concat(client_id)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              list.is_empty(versions),
              #[],
              versions
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, version_opt: Option<Version>) -> ByteArray {
                      bz
                        |> concat(
                            version_opt
                              |> size_for_version()
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
                |> encode_varint()
                |> push(0x18),
            ),
          )
        |> concat(
            counterparty
              |> Some()
              |> size_for_counterparty()
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
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              list.is_empty(versions),
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
                |> sov()
                |> add(1),
            ),
          )
        |> add(
            {
              let l = size_for_counterparty(Some(counterparty))
              l |> sov() |> add(l + 1)
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

test marshal_for_version_cost() {
  let some_version = Some(Version(#"0101", [#"0201", #"0202"]))
  let bytes = marshal_for_version(some_version)
  let length = size_for_version(some_version)
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_merkle_prefix_cost() {
  let some_merkle_prefix = Some(MerklePrefix(#"0501"))
  let bytes = marshal_for_merkle_prefix(some_merkle_prefix)
  let length = size_for_merkle_prefix(some_merkle_prefix)
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_counerparty_cost() {
  let some_counterparty =
    Some(new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")))
  let bytes = marshal_for_counterparty(some_counterparty)
  let length = size_for_counterparty(some_counterparty)
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_connection_end_cost() {
  let bytes =
    marshal_for_connection_end(
      Some(
        ConnectionEnd(
          #"0001",
          [Some(Version(#"0101", [#"0201", #"0202"]))],
          UNINITIALIZED,
          new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")),
          10,
        ),
      ),
    )
  trace bytearray.to_hex(bytes)
  True
}
// 58240A020001120C0A0201011202020112020202220E0A020301120204011A040A020501280A
// 58240A020001120C0A0201011202020112020202220C0A020301120204011A040A020501280A
