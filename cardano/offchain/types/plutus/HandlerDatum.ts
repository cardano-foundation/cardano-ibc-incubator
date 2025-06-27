import { Data } from "@lucid-evolution/lucid";
import { HandlerStateSchema } from "./HandlerState.ts";
import { AuthTokenSchema } from "./AuthToken.ts";

export const HandlerDatumSchema = Data.Object({
  state: HandlerStateSchema,
  token: AuthTokenSchema,
});
export type HandlerDatum = Data.Static<typeof HandlerDatumSchema>;
export const HandlerDatum = HandlerDatumSchema as unknown as HandlerDatum;
