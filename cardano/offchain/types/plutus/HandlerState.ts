import { Data } from "@lucid-evolution/lucid";

// HandlerState holds global IBC coordination state including sequence counters
// and the ICS-23 Merkle root for state verification
export const HandlerStateSchema = Data.Object({
  next_client_sequence: Data.Integer(),
  next_connection_sequence: Data.Integer(),
  next_channel_sequence: Data.Integer(),
  bound_port: Data.Array(Data.Integer()),
  // ICS-23 Merkle root committing to all IBC state (clients/, connections/, channels/, packets/)
  // This root is maintained deterministically and updated with each state change.
  // Mithril certificates attest to snapshots containing this UTXO, thus indirectly signing
  // the IBC state root, enabling light client proof verification on counterparty chains.
  ibc_state_root: Data.Bytes(), // 32-byte hash
});
export type HandlerState = Data.Static<typeof HandlerStateSchema>;
export const HandlerState = HandlerStateSchema as unknown as HandlerState;