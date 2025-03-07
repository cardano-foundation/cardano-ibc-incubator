use aiken/collection/list
use aiken/primitive/bytearray.{concat, length, push}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_length_varint,
  nest_record, size_and_concat, sov,
}
use ibc/utils/int.{Int32, Uint64}

pub type State {
  UNINITIALIZED
  INIT
  TRYOPEN
  OPEN
  CLOSED
  FLUSHING
  FLUSHCOMPLETE
}

pub type Order {
  NONE
  UNORDERED
  ORDERED
}

pub type Counterparty {
  port_id: ByteArray,
  channel_id: ByteArray,
}

pub type Channel {
  state: State,
  ordering: Order,
  counterparty: Counterparty,
  connection_hops: List<ByteArray>,
  version: ByteArray,
  upgrade_sequence: Uint64,
}

pub fn state_to_int32(state: State) -> Int32 {
  when state is {
    UNINITIALIZED -> 0
    INIT -> 1
    TRYOPEN -> 2
    OPEN -> 3
    CLOSED -> 4
    FLUSHING -> 5
    FLUSHCOMPLETE -> 6
  }
}

pub fn order_to_int32(order: Order) -> Int32 {
  when order is {
    NONE -> 0
    UNORDERED -> 1
    ORDERED -> 2
  }
}

pub fn marshal_for_counterparty(counterparty: Counterparty) {
  let Counterparty { port_id, channel_id } = counterparty
  (0, #"")
    |> size_and_concat(encode_bytearray(port_id, 10))
    |> size_and_concat(encode_bytearray(channel_id, 0x12))
}

pub fn marshal_for_channel(channel: Channel) -> (Int, ByteArray) {
  let Channel {
    state,
    ordering,
    counterparty,
    connection_hops,
    version,
    upgrade_sequence,
  } = channel
  (0, #"")
    |> add_and_concat(encode_int(state_to_int32(state), 8))
    |> add_and_concat(encode_int(order_to_int32(ordering), 0x10))
    |> add_and_concat(nest_record(marshal_for_counterparty(counterparty), 0x1a))
    |> add_and_concat(
        list.reduce(
          connection_hops,
          (0, #[]),
          fn((size, bz1), connection_hop: ByteArray) -> (Int, ByteArray) {
            let l = length(connection_hop)
            let bz2 =
              l
                |> encode_length_varint()
                |> concat(connection_hop)
                |> push(0x22)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> size_and_concat(encode_bytearray(version, 0x2a))
    |> add_and_concat(encode_int(upgrade_sequence, 0x30))
}
