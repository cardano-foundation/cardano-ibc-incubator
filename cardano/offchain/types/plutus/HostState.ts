import { Data } from "@lucid-evolution/lucid";

// HostState - STT Architecture
//
// Represents the canonical IBC host state maintained in a single UTXO
// identified by the IBC Host State NFT.
//
// STT Properties:
// - Exactly one HostState UTXO exists at any time (enforced by NFT uniqueness)
// - Version increments monotonically (prevents replay/rollback)
// - ibc_state_root is the ICS-23 Merkle commitment to all IBC state
// - NFT traces complete state history
export const HostStateSchema = Data.Object({
  version: Data.Integer(), // Monotonic version counter
  ibc_state_root: Data.Bytes(), // 32-byte ICS-23 Merkle root
  next_client_sequence: Data.Integer(),
  next_connection_sequence: Data.Integer(),
  next_channel_sequence: Data.Integer(),
  bound_port: Data.Array(Data.Integer()),
  last_update_time: Data.Integer(), // Unix epoch milliseconds
});

export type HostState = Data.Static<typeof HostStateSchema>;
export const HostState = HostStateSchema as unknown as HostState;

// HostStateDatum wraps the state with the NFT policy for verification
export const HostStateDatumSchema = Data.Object({
  state: HostStateSchema,
  nft_policy: Data.Bytes(), // Policy ID of the IBC Host State NFT
});

export type HostStateDatum = Data.Static<typeof HostStateDatumSchema>;
export const HostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;

