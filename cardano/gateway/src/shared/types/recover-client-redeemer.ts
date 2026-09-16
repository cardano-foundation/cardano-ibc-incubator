import { AuthToken } from './auth-token';

export type RecoverClientWithdrawalRedeemer = {
  RecoverClientWithdrawal: {
    subject_token: AuthToken;
    substitute_token: AuthToken;
  };
} | {
  CheckClientHistory: { subject_token: AuthToken };
} | {
  CheckStagedClientHistory: { subject_token: AuthToken };
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
  const RedeemerSchema = Data.Enum([
    Data.Object({ RecoverClientWithdrawal: Data.Object({
      subject_token: AuthTokenSchema,
      substitute_token: AuthTokenSchema,
    }) }),
    Data.Object({ CheckClientHistory: Data.Object({ subject_token: AuthTokenSchema }) }),
    Data.Literal('ReclaimStateWithdrawal'),
    Data.Object({ ReclaimTransferWithdrawal: Data.Object({ port_unit: Data.Bytes(), module_unit: Data.Bytes(), escrow_policy: Data.Bytes() }) }),
    Data.Object({ CheckStagedClientHistory: Data.Object({ subject_token: AuthTokenSchema }) }),
  ]);
  return Data.to(redeemer, RedeemerSchema as unknown as RecoverClientWithdrawalRedeemer, { canonical: true });
}
