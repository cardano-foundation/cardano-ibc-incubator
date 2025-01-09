import { type Data } from '@lucid-evolution/lucid';

export type AuthToken = {
  policyId: string;
  name: string;
};

export function encodeAuthToken(token: AuthToken, Lucid: typeof import('@lucid-evolution/lucid')) {
  const { Data } = Lucid;

  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  type TAuthToken = Data.Static<typeof AuthTokenSchema>;
  const TAuthToken = AuthTokenSchema as unknown as TAuthToken;
  return Data.to(token, TAuthToken);
}
