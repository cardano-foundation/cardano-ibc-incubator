/// ChannelState defines if a channel is in one of the following states:
/// CLOSED, INIT, TRYOPEN, OPEN or UNINITIALIZED.
pub type ChannelState {
  /// Default ChannelState
  Uninitialized
  /// A channel has just started the opening handshake.
  Init
  /// A channel has acknowledged the handshake step on the counterparty chain.
  TryOpen
  /// A channel has completed the handshake. Open channels are
  /// ready to send and receive packets.
  Open
  /// A channel has been closed and can no longer be used to send or receive packets.
  Closed
}
