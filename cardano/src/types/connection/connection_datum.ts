import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "../auth_token.ts";
import { ConnectionEndSchema } from "./connection_end.ts";

export const ConnectionDatumSchema = Data.Object({
  state: ConnectionEndSchema,
  token: AuthTokenSchema,
});
export type ConnectionDatum = Data.Static<typeof ConnectionDatumSchema>;
export const ConnectionDatum =
  ConnectionDatumSchema as unknown as ConnectionDatum;
