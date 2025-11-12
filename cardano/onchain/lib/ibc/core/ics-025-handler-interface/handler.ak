pub type HandlerState {
  next_client_sequence: Int,
  next_connection_sequence: Int,
  next_channel_sequence: Int,
  bound_port: List<Int>,
  // ICS-23 Merkle root commitment covering all IBC host state (clients/, connections/, channels/, packets/, etc.)
  // This root is maintained on-chain and updated with each IBC state change, allowing Mithril to certify it
  // via snapshot inclusion, which enables IBC's VerifyMembership/VerifyNonMembership proof verification.
  ibc_state_root: ByteArray,
}
