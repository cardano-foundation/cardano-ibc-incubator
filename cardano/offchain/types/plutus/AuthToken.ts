import { Data } from "@lucid-evolution/lucid";

export const AuthTokenSchema = Data.Object({
  policy_id: Data.Bytes(),
  name: Data.Bytes(),
});
export type AuthToken = Data.Static<typeof AuthTokenSchema>;
export const AuthToken = AuthTokenSchema as unknown as AuthToken;
