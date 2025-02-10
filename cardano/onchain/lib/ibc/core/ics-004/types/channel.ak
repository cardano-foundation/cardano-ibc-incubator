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
