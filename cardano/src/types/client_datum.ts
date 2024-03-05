import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { ClientStateSchema } from "./client_state.ts";
import { AuthTokenSchema } from "./auth_token.ts";
import { HeightSchema } from "./height.ts";
import { ConsensusStateSchema } from "./consensus_state.ts";

export const ClientDatumStateSchema = Data.Object({
  clientState: ClientStateSchema,
  consensusStates: Data.Map(HeightSchema, ConsensusStateSchema),
});
export type ClientDatumState = Data.Static<typeof ClientDatumStateSchema>;
export const ClientDatumState =
  ClientDatumStateSchema as unknown as ClientDatumState;

export const ClientDatumSchema = Data.Object({
  state: ClientDatumStateSchema,
  token: AuthTokenSchema,
});
export type ClientDatum = Data.Static<typeof ClientDatumSchema>;
export const ClientDatum =
  ClientDatumSchema as unknown as ClientDatum;
