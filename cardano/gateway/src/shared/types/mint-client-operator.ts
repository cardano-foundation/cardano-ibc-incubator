import { type Data } from 'lucid-cardano';

export type MintClientOperator =
  | 'MintConsensusState'
  | {
      MintNewClient: {
        handlerAuthToken: {
          name: string;
          policyId: string;
        };
      };
    };
export async function encodeMintClientOperator(
  mintClientOperator: MintClientOperator,
  Lucid: typeof import('lucid-cardano'),
) {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const MintClientOperatorSchema = Data.Enum([
    Data.Object({
      MintNewClient: Data.Object({ handlerAuthToken: AuthTokenSchema }),
    }),
    Data.Literal('MintConsensusState'),
  ]);
  type TMintClientOperator = Data.Static<typeof MintClientOperatorSchema>;
  const TMintClientOperator = MintClientOperatorSchema as unknown as MintClientOperator;

  return Data.to(mintClientOperator, TMintClientOperator);
}
