import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { VersionSchema } from "./version.ts";
import { StateSchema } from "./state.ts";
import { CounterpartySchema } from "./counterparty.ts";

export const ConnectionEndSchema = Data.Object({
  client_id: Data.Bytes(),
  versions: Data.Array(VersionSchema),
  state: StateSchema,
  counterparty: CounterpartySchema,
  delay_period: Data.Integer(),
});
export type ConnectionEnd = Data.Static<typeof ConnectionEndSchema>;
export const ConnectionEnd = ConnectionEndSchema as unknown as ConnectionEnd;
