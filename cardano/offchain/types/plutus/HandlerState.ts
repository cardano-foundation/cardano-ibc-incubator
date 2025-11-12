import { Data } from "@lucid-evolution/lucid";

// HandlerState maintains global IBC state including the ICS-23 Merkle root commitment
// The ibc_state_root covers all IBC host state (clients/, connections/, channels/, packets/, etc.)
// and is updated with each state change, allowing Mithril to certify it via snapshot inclusion.
export const HandlerStateSchema = Data.Object({
  next_client_sequence: Data.Integer(),
  next_connection_sequence: Data.Integer(),
  next_channel_sequence: Data.Integer(),
  bound_port: Data.Array(Data.Integer()),
  ibc_state_root: Data.Bytes(), // 32-byte ICS-23 Merkle root
});
export type HandlerState = Data.Static<typeof HandlerStateSchema>;
export const HandlerState = HandlerStateSchema as unknown as HandlerState;