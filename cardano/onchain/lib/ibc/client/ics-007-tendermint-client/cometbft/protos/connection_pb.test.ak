use aiken/builtin.{if_then_else as ite}
use aiken/collection/list
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb.{
  INIT, OPEN, State, TRYOPEN, UNINITIALIZED,
}
use ibc/core/ics_003_connection_semantics/types/counterparty.{
  Counterparty, new_counterparty,
}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/utils/bytes.{encode_length_varint, encode_varint, sov_length}
use ibc/utils/int.{Int32, Uint64}

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

pub type ConnectionEnd {
  client_id: ByteArray,
  versions: List<Version>,
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

pub fn size_and_concat(
  a: (Int, ByteArray),
  b: (Int, ByteArray),
) -> (Int, ByteArray) {
  let (size, bz1) = a
  let (length, bz2) = b
  (size + sov_length(length) + length + 1, concat(bz1, bz2))
}

pub fn add_and_concat(
  a: (Int, ByteArray),
  b: (Int, ByteArray),
) -> (Int, ByteArray) {
  let (size1, bz1) = a
  let (size2, bz2) = b
  (size1 + size2, concat(bz1, bz2))
}

pub fn encode_bytearray(bz1: ByteArray, identifier: Int) -> (Int, ByteArray) {
  let l = length(bz1)
  ite(
    l == 0,
    (0, #[]),
    {
      let bz2 = l |> encode_length_varint() |> concat(bz1) |> push(identifier)
      (l, bz2)
    },
  )
}

pub fn marshal_for_merkle_prefix(
  merkle_prefix: MerklePrefix,
) -> (Int, ByteArray) {
  let MerklePrefix { key_prefix } = merkle_prefix
  (0, #[])
    |> size_and_concat(encode_bytearray(key_prefix, 10))
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
          (size, bz2)
        },
      )
}

test marshal_for_version_cost() {
  let (length, bytes) =
    marshal_for_version(Version(#"0101", [#"0201", #"0202"]))
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_merkle_prefix_cost() {
  let (length, bytes) = marshal_for_merkle_prefix(MerklePrefix(#"0501"))
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_counerparty_cost() {
  let (length, bytes) =
    marshal_for_counterparty(
      new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")),
    )
  trace length
  trace bytearray.to_hex(bytes)
  True
}

test marshal_for_connection_end_cost() {
  let bytes =
    marshal_for_connection_end(
      ConnectionEnd(
        #"0001",
        [Version(#"0101", [#"0201", #"0202"])],
        UNINITIALIZED,
        new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")),
        10,
      ),
    )
  trace bytearray.to_hex(bytes)
  True
}
