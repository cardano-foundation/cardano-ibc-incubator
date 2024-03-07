import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "../auth_token.ts";

export const MintPortRedeemerSchema = Data.Object({
  handler_token: AuthTokenSchema,
  spend_module_script_hash: Data.Bytes(),
  port_number: Data.Integer(),
});

export type MintPortRedeemer = Data.Static<typeof MintPortRedeemerSchema>;
export const MintPortRedeemer =
  MintPortRedeemerSchema as unknown as MintPortRedeemer;
