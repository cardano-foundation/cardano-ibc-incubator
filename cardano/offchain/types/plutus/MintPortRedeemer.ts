import { Data } from "@lucid-evolution/lucid";

export const MintPortRedeemerSchema = Data.Object({
  spend_module_script_hash: Data.Bytes(),
  port_id: Data.Bytes(),
});
export type MintPortRedeemer = Data.Static<typeof MintPortRedeemerSchema>;
export const MintPortRedeemer =
  MintPortRedeemerSchema as unknown as MintPortRedeemer;
