use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/state.{ChannelState, Uninitialized}
use ibc/core/ics_024_host_requirements/validate

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

pub fn validate_basic(ch: Channel) -> Bool {
  expect ch.state != Uninitialized

  expect ch.ordering == Ordered || ch.ordering == Unordered

  expect [connection_id] = ch.connection_hops

  expect validate.connection_identifier_validator(connection_id)

  expect counterparty.validate_basic(ch.counterparty)

  True
}
