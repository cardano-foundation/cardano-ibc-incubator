// Frozen public commitment primitive. Keep its constructors and order unchanged.
// See docs/cardano-commitment-codec.md.
/// ChannelState defines if a channel is in one of the following states:
/// CLOSED, INIT, TRYOPEN, OPEN, FLUSHING, FLUSHCOMPLETE or UNINITIALIZED.
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
  /// A channel is settling packets sent before its upgrade. It cannot send.
  Flushing
  /// A channel has no packets in flight and waits to open with its upgrade.
  FlushComplete
}
