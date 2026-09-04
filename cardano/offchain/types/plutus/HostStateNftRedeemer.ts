import { Data } from "@lucid-evolution/lucid";

export const HostStateNftRedeemerSchema = Data.Enum([
  Data.Literal("MintInitial"),
  Data.Literal("BurnFinal"),
]);

export type HostStateNftRedeemer = Data.Static<
  typeof HostStateNftRedeemerSchema
>;
export const HostStateNftRedeemer =
  HostStateNftRedeemerSchema as unknown as HostStateNftRedeemer;
