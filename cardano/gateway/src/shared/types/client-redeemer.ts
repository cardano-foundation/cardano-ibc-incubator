import { Header } from './header';
import { type Data } from 'lucid-cardano';

export type SpendClientRedeemer =
  | 'Other'
  | {
      UpdateClient: {
        header: Header;
      };
    };
export async function encodeSpendClientRedeemer(
  spendClientRedeemer: SpendClientRedeemer,
  Lucid: typeof import('lucid-cardano'),
) {
  const { Data } = Lucid;
  const PartSetHeaderSchema = Data.Object({
    total: Data.Integer(),
    hash: Data.Bytes(),
  });
  const BlockIDSchema = Data.Object({
    hash: Data.Bytes(),
    partSetHeader: PartSetHeaderSchema,
  });
  const CommitSigSchema = Data.Object({
    block_id_flag: Data.Integer(),
    validator_address: Data.Bytes(),
    timestamp: Data.Integer(),
    signature: Data.Bytes(),
  });
  const CommitSchema = Data.Object({
    height: Data.Integer(),
    blockId: BlockIDSchema,
    signatures: Data.Array(CommitSigSchema),
  });
  const TmHeaderSchema = Data.Object({
    chainId: Data.Bytes(),
    height: Data.Integer(),
    time: Data.Integer(),
    validatorsHash: Data.Bytes(),
    nextValidatorsHash: Data.Bytes(),
    appHash: Data.Bytes(),
  });
  const SignedHeaderSchema = Data.Object({
    header: TmHeaderSchema,
    commit: CommitSchema,
  });
  const ValidatorSchema = Data.Object({
    address: Data.Bytes(),
    pubkey: Data.Bytes(),
    votingPower: Data.Integer(),
    proposerPriority: Data.Integer(),
  });
  const ValidatorSetSchema = Data.Object({
    validators: Data.Array(ValidatorSchema),
    proposer: ValidatorSchema,
    totalVotingPower: Data.Integer(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const HeaderSchema = Data.Object({
    signedHeader: SignedHeaderSchema,
    validatorSet: ValidatorSetSchema,
    trustedHeight: HeightSchema,
    trustedValidators: ValidatorSetSchema,
  });
  const SpendClientRedeemerSchema = Data.Enum([
    Data.Object({
      UpdateClient: Data.Object({ header: HeaderSchema }),
    }),
    Data.Literal('Other'),
  ]);
  type TSpendClientRedeemer = Data.Static<typeof SpendClientRedeemerSchema>;
  const TSpendClientRedeemer = SpendClientRedeemerSchema as unknown as SpendClientRedeemer;
  return Data.to(spendClientRedeemer, TSpendClientRedeemer);
}
