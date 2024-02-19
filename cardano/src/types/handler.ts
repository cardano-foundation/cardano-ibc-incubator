import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "./auth_token.ts";

const HandlerStateSchema = Data.Object({
  next_client_sequence: Data.Integer(),
});
export type HandlerState = Data.Static<typeof HandlerStateSchema>;
export const HandlerState = HandlerStateSchema as unknown as HandlerState;

export const HandlerDatumSchema = Data.Object({
  state: HandlerStateSchema,
  token: AuthTokenSchema,
});
export type HandlerDatum = Data.Static<typeof HandlerDatumSchema>;
export const HandlerDatum = HandlerDatumSchema as unknown as HandlerDatum;
