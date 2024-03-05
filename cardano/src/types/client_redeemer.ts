import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "./auth_token.ts";
import { HeaderSchema } from "./header.ts";

export const MintClientRedeemerSchema = Data.Object({
  handlerAuthToken: AuthTokenSchema,
});

export type MintClientRedeemer = Data.Static<typeof MintClientRedeemerSchema>;
export const MintClientRedeemer =
  MintClientRedeemerSchema as unknown as MintClientRedeemer;

export const SpendClientRedeemerSchema = Data.Enum([
  Data.Object({
    UpdateClient: Data.Object({ header: HeaderSchema }),
  }),
  Data.Literal("Other"),
]);
export type SpendClientRedeemer = Data.Static<typeof SpendClientRedeemerSchema>;
export const SpendClientRedeemer =
  SpendClientRedeemerSchema as unknown as SpendClientRedeemer;
