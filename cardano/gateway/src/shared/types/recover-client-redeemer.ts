import { AuthToken } from './auth-token';

export type RecoverClientWithdrawalRedeemer = {
  RecoverClientWithdrawal: {
    subject_token: AuthToken;
    substitute_token: AuthToken;
  };
};

export function encodeRecoverClientWithdrawalRedeemer(
  redeemer: RecoverClientWithdrawalRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
): string {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const RedeemerSchema = Data.Object({
    subject_token: AuthTokenSchema,
    substitute_token: AuthTokenSchema,
  });
  const TRecoverClientWithdrawalRedeemer =
    RedeemerSchema as unknown as RecoverClientWithdrawalRedeemer['RecoverClientWithdrawal'];

  return Data.to(redeemer.RecoverClientWithdrawal, TRecoverClientWithdrawalRedeemer, { canonical: true });
}
