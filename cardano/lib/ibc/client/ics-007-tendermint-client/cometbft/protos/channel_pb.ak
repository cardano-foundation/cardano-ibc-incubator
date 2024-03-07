// DO NOT EDIT.
// source: ibc/core/channel/v1/channel.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, length, push}
use aiken/list
use aiken/option.{is_none}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int32, Int64, Uint64, uint64}

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

pub fn marshal_for_counterparty(
  counterparty_opt: Option<Counterparty>,
) -> ByteArray {
  ite(
    is_none(counterparty_opt),
    #[],
    {
      expect Some(counterparty) = counterparty_opt
      let Counterparty { port_id, channel_id } = counterparty
      #[]
        |> concat(
             ite(
               length(port_id) == 0,
               #[],
               port_id
                 |> length()
                 |> uint64()
                 |> encode_varint_channel()
                 |> concat(port_id)
                 |> push(10),
             ),
           )
        |> concat(
             ite(
               length(channel_id) == 0,
               #[],
               channel_id
                 |> length()
                 |> uint64()
                 |> encode_varint_channel()
                 |> concat(channel_id)
                 |> push(0x12),
             ),
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
      let Counterparty { port_id, channel_id } = counterparty
      0
        |> add(
             ite(
               length(port_id) == 0,
               0,
               {
                 let l = length(port_id)
                 l |> uint64() |> sov_channel() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(channel_id) == 0,
               0,
               {
                 let l = length(channel_id)
                 l |> uint64() |> sov_channel() |> add(l + 1)
               },
             ),
           )
    },
  )
}

pub fn marshal_for_channel(channel_opt: Option<Channel>) -> ByteArray {
  ite(
    is_none(channel_opt),
    #[],
    {
      expect Some(channel) = channel_opt
      let Channel {
        state,
        ordering,
        counterparty,
        connection_hops,
        version,
        upgrade_sequence,
      } = channel
      #[]
        |> concat(
             ite(
               state_to_int32(state) == 0,
               #[],
               state
                 |> state_to_int32()
                 |> uint64()
                 |> encode_varint_channel()
                 |> push(8),
             ),
           )
        |> concat(
             ite(
               order_to_int32(ordering) == 0,
               #[],
               ordering
                 |> order_to_int32()
                 |> uint64()
                 |> encode_varint_channel()
                 |> push(0x10),
             ),
           )
        |> concat(
             counterparty
               |> Some()
               |> size_for_counterparty()
               |> uint64()
               |> encode_varint_channel()
               |> concat(marshal_for_counterparty(Some(counterparty)))
               |> push(0x1a),
           )
        |> concat(
             ite(
               list.length(connection_hops) == 0,
               #[],
               connection_hops
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, connection_hop: ByteArray) -> ByteArray {
                        bz
                          |> concat(
                               connection_hop
                                 |> length()
                                 |> uint64()
                                 |> encode_varint_channel()
                                 |> concat(connection_hop)
                                 |> push(0x22),
                             )
                      },
                    ),
             ),
           )
        |> concat(
             ite(
               length(version) == 0,
               #[],
               version
                 |> length()
                 |> uint64()
                 |> encode_varint_channel()
                 |> concat(version)
                 |> push(0x2a),
             ),
           )
        |> concat(
             ite(
               upgrade_sequence == 0,
               #[],
               upgrade_sequence
                 |> uint64()
                 |> encode_varint_channel()
                 |> push(0x30),
             ),
           )
    },
  )
}

pub fn size_for_channel(channel_opt: Option<Channel>) -> Int {
  ite(
    is_none(channel_opt),
    0,
    {
      expect Some(channel) = channel_opt
      let Channel {
        state,
        ordering,
        counterparty,
        connection_hops,
        version,
        upgrade_sequence,
      } = channel
      0
        |> add(
             ite(
               state_to_int32(state) == 0,
               0,
               state
                 |> state_to_int32()
                 |> uint64()
                 |> sov_channel()
                 |> add(1),
             ),
           )
        |> add(
             ite(
               order_to_int32(ordering) == 0,
               0,
               ordering
                 |> order_to_int32()
                 |> uint64()
                 |> sov_channel()
                 |> add(1),
             ),
           )
        |> add(
             {
               let l = size_for_counterparty(Some(counterparty))
               l |> uint64() |> sov_channel() |> add(l + 1)
             },
           )
        |> add(
             ite(
               list.length(connection_hops) == 0,
               0,
               connection_hops
                 |> list.reduce(
                      0,
                      fn(sz: Int, connection_hop: ByteArray) -> Int {
                        let l = length(connection_hop)
                        l
                          |> uint64()
                          |> sov_channel()
                          |> add(l + 1 + sz)
                      },
                    ),
             ),
           )
        |> add(
             ite(
               length(version) == 0,
               0,
               {
                 let l = length(version)
                 l |> uint64() |> sov_channel() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               upgrade_sequence == 0,
               0,
               upgrade_sequence |> uint64() |> sov_channel() |> add(1),
             ),
           )
    },
  )
}

fn encode_varint_channel(v: Int64) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_channel()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}

fn sov_channel(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}
