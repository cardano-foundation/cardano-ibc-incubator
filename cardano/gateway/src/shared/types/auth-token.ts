import { type Data } from '@dinhbx/lucid-custom';

export type AuthToken = {
  policyId: string;
  name: string;
};

export function encodeAuthToken(token: AuthToken, Lucid: typeof import('@dinhbx/lucid-custom')) {
  const { Data } = Lucid;

  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });

  type TAuthToken = Data.Static<typeof AuthTokenSchema>;
  const TAuthToken = AuthTokenSchema as unknown as TAuthToken;
  return Data.to(token, TAuthToken);
}
