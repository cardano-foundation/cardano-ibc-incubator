use aiken/collection/list
use aiken/fuzz
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{None, Ordered, Unordered}
use ibc/core/ics_004/types/state.{Closed, Init, Open, TryOpen, Uninitialized}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

// Every generated payload is checked with every supported state/order, including
// default enums. Arbitrary bytes and lengths exercise wire encoding independently
// of identifier validation; this does not expand the domain accepted by validators.
fn channel_fields() -> Fuzzer<
  (ByteArray, ByteArray, List<ByteArray>, ByteArray),
> {
  fuzz.tuple4(
    fuzz.bytearray_between(0, 260),
    fuzz.bytearray_between(0, 260),
    fuzz.list_between(fuzz.bytearray_between(0, 260), 0, 3),
    fuzz.bytearray_between(0, 260),
  )
}

test channel_matches_generated_marshaller(fields via channel_fields()) {
  let (port_id, channel_id, connection_hops, version) = fields
  list.all(
    [Uninitialized, Init, TryOpen, Open, Closed],
    fn(state) {
      list.all(
        [None, Unordered, Ordered],
        fn(ordering) {
          let value =
            Channel {
              state,
              ordering,
              counterparty: ChannelCounterparty { port_id, channel_id },
              connection_hops,
              version,
            }
          let actual = channel.marshal(value)
          and {
            actual == channel_pb.marshal_for_channel(
              channel.convert_to_channel_proto(value),
            ),
            actual.1st == bytearray.length(actual.2nd),
          }
        },
      )
    },
  )
}

fn connection_fields() -> Fuzzer<(ByteArray, List<Version>, Counterparty, Int)> {
  fuzz.tuple4(
    fuzz.bytearray_between(0, 260),
    fuzz.list_between(
      fuzz.map2(
        fuzz.bytearray_between(0, 260),
        fuzz.list_between(fuzz.bytearray_between(0, 260), 0, 3),
        fn(identifier, features) { Version { identifier, features } },
      ),
      0,
      3,
    ),
    fuzz.map3(
      fuzz.bytearray_between(0, 260),
      fuzz.bytearray_between(0, 260),
      fuzz.bytearray_between(0, 260),
      fn(client_id, connection_id, key_prefix) {
        Counterparty {
          client_id,
          connection_id,
          prefix: MerklePrefix { key_prefix },
        }
      },
    ),
    fuzz.int_between(0, 18446744073709551615),
  )
}

test connection_matches_generated_marshaller(fields via connection_fields()) {
  let (client_id, versions, counterparty, delay_period) = fields
  list.all(
    [
      connection_state.Uninitialized,
      connection_state.Init,
      connection_state.TryOpen,
      connection_state.Open,
    ],
    fn(state) {
      let value =
        ConnectionEnd { client_id, versions, state, counterparty, delay_period }
      connection_end.marshal(value) == connection_pb.marshal_for_connection_end(
        connection_end.convert_to_connection_end_proto(value),
      )
    },
  )
}
