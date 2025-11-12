// HandlerState holds global IBC coordination state including sequence counters
// and the ICS-23 Merkle root for state verification
pub type HandlerState {
  next_client_sequence: Int,
  next_connection_sequence: Int,
  next_channel_sequence: Int,
  bound_port: List<Int>,
  // ICS-23 Merkle root committing to all IBC state (clients/, connections/, channels/, packets/)
  // This root is maintained deterministically and updated with each state change.
  // Mithril certificates attest to snapshots containing this UTXO, thus indirectly signing
  // the IBC state root, enabling light client proof verification on counterparty chains.
  ibc_state_root: ByteArray, // 32-byte hash
}
