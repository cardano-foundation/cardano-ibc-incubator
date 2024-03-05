import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const AuthTokenSchema = Data.Object({
  policyId: Data.Bytes(),
  name: Data.Bytes(),
});
export type AuthToken = Data.Static<typeof AuthTokenSchema>;
export const AuthToken = AuthTokenSchema as unknown as AuthToken;
