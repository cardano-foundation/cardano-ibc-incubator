import { type Data } from '@cuonglv0297/lucid-custom';

export type AuthToken = {
  policyId: string;
  name: string;
};

export function encodeAuthToken(token: AuthToken, Lucid: typeof import('@cuonglv0297/lucid-custom')) {
  const { Data } = Lucid;

  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  type TAuthToken = Data.Static<typeof AuthTokenSchema>;
  const TAuthToken = AuthTokenSchema as unknown as TAuthToken;
  return Data.to(token, TAuthToken);
}
