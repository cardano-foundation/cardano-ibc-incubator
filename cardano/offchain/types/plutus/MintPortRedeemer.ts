import { Data } from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "./AuthToken.ts";

export const MintPortRedeemerSchema = Data.Object({
  handler_token: AuthTokenSchema,
  spend_module_script_hash: Data.Bytes(),
  port_number: Data.Integer(),
});
export type MintPortRedeemer = Data.Static<typeof MintPortRedeemerSchema>;
export const MintPortRedeemer =
  MintPortRedeemerSchema as unknown as MintPortRedeemer;
