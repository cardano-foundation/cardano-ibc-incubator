use aiken/collection/list
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb.{
  CLOSED, Channel as ChannelProto, Counterparty as CounterpartyProto, INIT, NONE,
  OPEN, ORDERED, Order as OrderProto, State as StateProto, TRYOPEN,
  UNINITIALIZED, UNORDERED,
}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{None, Order, Ordered, Unordered}
use ibc/core/ics_004/types/state.{
  ChannelState, Closed, Init, Open, TryOpen, Uninitialized,
}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_length_varint,
  nest_record, size_and_concat, sov,
}

/// Channel defines pipeline for exactly-once packet delivery between specific
/// modules on separate blockchains, which has at least one end capable of
/// sending packets and one end capable of receiving packets.
pub type Channel {
  /// current state of the channel end
  state: ChannelState,
  /// whether the channel is ordered or unordered
  ordering: Order,
  /// counterparty channel end
  counterparty: ChannelCounterparty,
  /// list of connection identifiers, in order, along which packets sent on
  /// this channel will travel
  connection_hops: List<ByteArray>,
  /// opaque channel version, which is agreed upon during the handshake
  version: ByteArray,
}

/// Canonical IBC protobuf bytes and length for the supported domain states.
/// Field 6 (upgrade_sequence) is always zero in the domain and is omitted.
pub fn marshal(channel: Channel) -> (Int, ByteArray) {
  let Channel { state, ordering, counterparty, connection_hops, version } =
    channel
  (0, #"")
    |> add_and_concat(
        encode_int(
          when state is {
            Uninitialized -> 0
            Init -> 1
            TryOpen -> 2
            Open -> 3
            Closed -> 4
          },
          bytes.field_1_varint,
        ),
      )
    |> add_and_concat(
        encode_int(
          when ordering is {
            None -> 0
            Unordered -> 1
            Ordered -> 2
          },
          bytes.field_2_varint,
        ),
      )
    |> add_and_concat(
        nest_record(
          (0, #[])
            |> size_and_concat(
                encode_bytearray(
                  counterparty.port_id,
                  bytes.field_1_length_delimited,
                ),
              )
            |> size_and_concat(
                encode_bytearray(
                  counterparty.channel_id,
                  bytes.field_2_length_delimited,
                ),
              ),
          bytes.field_3_length_delimited,
        ),
      )
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
                |> push(bytes.field_4_length_delimited)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> size_and_concat(
        encode_bytearray(version, bytes.field_5_length_delimited),
      )
}

pub fn convert_to_channel_proto(channel: Channel) -> ChannelProto {
  ChannelProto {
    state: convert_to_state_proto(channel.state),
    ordering: convert_to_order_proto(channel.ordering),
    counterparty: convert_to_counterparty_proto(channel.counterparty),
    connection_hops: channel.connection_hops,
    version: channel.version,
    upgrade_sequence: 0,
  }
}

pub fn convert_to_state_proto(state: ChannelState) -> StateProto {
  when state is {
    Uninitialized -> UNINITIALIZED
    Init -> INIT
    TryOpen -> TRYOPEN
    Open -> OPEN
    Closed -> CLOSED
  }
}

pub fn convert_to_order_proto(order: Order) -> OrderProto {
  when order is {
    None -> NONE
    Unordered -> UNORDERED
    Ordered -> ORDERED
  }
}

pub fn convert_to_counterparty_proto(
  counterparty: ChannelCounterparty,
) -> CounterpartyProto {
  CounterpartyProto {
    port_id: counterparty.port_id,
    channel_id: counterparty.channel_id,
  }
}

/// Validate basic Channel's props.
/// It should be only 1 connection_id in connection_hops and that id
/// must be a valid Cardano IBC connection ID.
pub fn validate_basic(ch: Channel) -> Bool {
  // state should be checked at another functions
  // expect ch.state != Uninitialized 
  expect [connection_id] = ch.connection_hops
  and {
    ch.ordering == Ordered || ch.ordering == Unordered,
    conn_keys_mod.is_valid_connection_id(connection_id),
    counterparty.validate_basic(ch.counterparty),
  }
}

/// return a new Channel with all fields set to zero.
pub fn null_channel() -> Channel {
  Channel {
    state: Uninitialized,
    ordering: None,
    counterparty: ChannelCounterparty { port_id: "", channel_id: "" },
    connection_hops: [],
    version: "",
  }
}

pub fn new(
  state: ChannelState,
  ordering: Order,
  counterparty: ChannelCounterparty,
  connection_hops: List<ByteArray>,
  version: ByteArray,
) -> Channel {
  Channel { state, ordering, counterparty, connection_hops, version }
}
