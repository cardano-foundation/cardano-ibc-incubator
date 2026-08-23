import { Data } from "@lucid-evolution/lucid";
import { OutputReferenceSchema } from "./OutputReference.ts";
import { AuthTokenSchema } from "./AuthToken.ts";

export const ModuleRegistrationSchema = Data.Object({
  module_script_hash: Data.Bytes(),
  port_token: AuthTokenSchema,
  module_token: AuthTokenSchema,
});

export type ModuleRegistration = Data.Static<typeof ModuleRegistrationSchema>;
export const ModuleRegistration =
  ModuleRegistrationSchema as unknown as ModuleRegistration;

export const ShutdownStateSchema = Data.Enum([
  Data.Literal("Active"),
  Data.Object({
    ShuttingDown: Data.Object({
      initiated_at: Data.Integer(),
      grace_period_end: Data.Integer(),
    }),
  }),
  Data.Object({
    Sealed: Data.Object({
      sealed_at: Data.Integer(),
      proof_window_end: Data.Integer(),
    }),
  }),
]);

export type ShutdownState = Data.Static<typeof ShutdownStateSchema>;
export const ShutdownState = ShutdownStateSchema as unknown as ShutdownState;

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
  bound_port: Data.Map(Data.Bytes(), ModuleRegistrationSchema),
  last_update_time: Data.Integer(), // Unix epoch milliseconds
  live_client_count: Data.Integer(),
  live_connection_count: Data.Integer(),
  live_channel_count: Data.Integer(),
});

export type HostState = Data.Static<typeof HostStateSchema>;
export const HostState = HostStateSchema as unknown as HostState;

export const ReferenceScriptRegistrationSchema = Data.Object({
  target_count: Data.Integer(),
  target_root: Data.Bytes(),
  last_out_ref: OutputReferenceSchema,
});
export type ReferenceScriptRegistration = Data.Static<
  typeof ReferenceScriptRegistrationSchema
>;
export const ReferenceScriptRegistration =
  ReferenceScriptRegistrationSchema as unknown as ReferenceScriptRegistration;

// HostStateDatum wraps the state with the NFT policy for verification
export const HostStateDatumSchema = Data.Object({
  state: HostStateSchema,
  nft_policy: Data.Bytes(), // Policy ID of the IBC Host State NFT
  deployer: Data.Bytes(),
  shutdown: ShutdownStateSchema,
  // Null is permitted only during deployment, before the complete reference
  // inventory has been registered against HostState.
  live_reference_script_count: Data.Nullable(Data.Integer()),
  reference_script_inventory_root: Data.Bytes(),
  reference_script_registration: Data.Nullable(
    ReferenceScriptRegistrationSchema,
  ),
});

export type HostStateDatum = Data.Static<typeof HostStateDatumSchema>;
export const HostStateDatum = HostStateDatumSchema as unknown as HostStateDatum;
