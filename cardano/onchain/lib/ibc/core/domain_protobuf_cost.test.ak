// Paired measurements of the complete encoding expression at each production
// call-site shape. Both sides include the same non-empty-output assertion.
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/state.{Closed, Init, Open, TryOpen}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

fn connection_value(state, connection_id) -> ConnectionEnd {
  ConnectionEnd {
    client_id: "07-tendermint-0",
    versions: [
      Version {
        identifier: "1",
        features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
      },
    ],
    state,
    counterparty: Counterparty {
      client_id: "099-cardano-1",
      connection_id,
      prefix: MerklePrefix { key_prefix: "ibc" },
    },
    delay_period: 0,
  }
}

fn channel_value(state, ordering, channel_id) -> Channel {
  Channel {
    state,
    ordering,
    counterparty: ChannelCounterparty { port_id: "transfer", channel_id },
    connection_hops: ["connection-3"],
    version: "ics20-1",
  }
}

test conn_open_try_legacy() {
  let value = connection_value(connection_state.Init, "")
  bytearray.length(
    connection_pb.marshal_for_connection_end(
      connection_end.convert_to_connection_end_proto(value),
    ),
  ) > 0
}

test conn_open_try_direct() {
  let value = connection_value(connection_state.Init, "")
  bytearray.length(connection_end.marshal(value)) > 0
}

test conn_open_ack_legacy() {
  let value = connection_value(connection_state.TryOpen, "connection-2")
  bytearray.length(
    connection_pb.marshal_for_connection_end(
      connection_end.convert_to_connection_end_proto(value),
    ),
  ) > 0
}

test conn_open_ack_direct() {
  let value = connection_value(connection_state.TryOpen, "connection-2")
  bytearray.length(connection_end.marshal(value)) > 0
}

test conn_open_confirm_legacy() {
  let value = connection_value(connection_state.Open, "connection-2")
  bytearray.length(
    connection_pb.marshal_for_connection_end(
      connection_end.convert_to_connection_end_proto(value),
    ),
  ) > 0
}

test conn_open_confirm_direct() {
  let value = connection_value(connection_state.Open, "connection-2")
  bytearray.length(connection_end.marshal(value)) > 0
}

test chan_open_try_unordered_legacy() {
  let value = channel_value(Init, Unordered, "")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_try_unordered_direct() {
  let value = channel_value(Init, Unordered, "")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_open_try_ordered_legacy() {
  let value = channel_value(Init, Ordered, "")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_try_ordered_direct() {
  let value = channel_value(Init, Ordered, "")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_open_ack_unordered_legacy() {
  let value = channel_value(TryOpen, Unordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_ack_unordered_direct() {
  let value = channel_value(TryOpen, Unordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_open_ack_ordered_legacy() {
  let value = channel_value(TryOpen, Ordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_ack_ordered_direct() {
  let value = channel_value(TryOpen, Ordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_open_confirm_unordered_legacy() {
  let value = channel_value(Open, Unordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_confirm_unordered_direct() {
  let value = channel_value(Open, Unordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_open_confirm_ordered_legacy() {
  let value = channel_value(Open, Ordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_open_confirm_ordered_direct() {
  let value = channel_value(Open, Ordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_close_confirm_unordered_legacy() {
  let value = channel_value(Closed, Unordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_close_confirm_unordered_direct() {
  let value = channel_value(Closed, Unordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test chan_close_confirm_ordered_legacy() {
  let value = channel_value(Closed, Ordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test chan_close_confirm_ordered_direct() {
  let value = channel_value(Closed, Ordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test timeout_on_close_unordered_legacy() {
  let value = channel_value(Closed, Unordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test timeout_on_close_unordered_direct() {
  let value = channel_value(Closed, Unordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}

test timeout_on_close_ordered_legacy() {
  let value = channel_value(Closed, Ordered, "channel-7")
  bytearray.length(
    channel_pb.marshal_for_channel(channel.convert_to_channel_proto(value)).2nd,
  ) > 0
}

test timeout_on_close_ordered_direct() {
  let value = channel_value(Closed, Ordered, "channel-7")
  bytearray.length(channel.marshal(value).2nd) > 0
}
