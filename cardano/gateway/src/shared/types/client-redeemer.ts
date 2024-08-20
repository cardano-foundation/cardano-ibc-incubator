import { type Data } from '@cuonglv0297/lucid-custom';
import { ClientMessage } from './msgs/client-message';

export type SpendClientRedeemer =
  | 'Other'
  | {
      UpdateClient: {
        msg: ClientMessage;
      };
    };
export async function encodeSpendClientRedeemer(
  spendClientRedeemer: SpendClientRedeemer,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
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
    round: Data.Integer(),
    blockId: BlockIDSchema,
    signatures: Data.Array(CommitSigSchema),
  });
  const ConsensusSchema = Data.Object({
    block: Data.Integer(),
    app: Data.Integer(),
  });
  const TmHeaderSchema = Data.Object({
    version: ConsensusSchema,
    chainId: Data.Bytes(),
    height: Data.Integer(),
    time: Data.Integer(),
    lastBlockId: BlockIDSchema,
    lastCommitHash: Data.Bytes(),
    dataHash: Data.Bytes(),
    validatorsHash: Data.Bytes(),
    nextValidatorsHash: Data.Bytes(),
    consensusHash: Data.Bytes(),
    appHash: Data.Bytes(),
    lastResultsHash: Data.Bytes(),
    evidenceHash: Data.Bytes(),
    proposerAddress: Data.Bytes(),
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

  const MisbehaviourSchema = Data.Object({
    client_id: Data.Bytes(),
    header1: HeaderSchema,
    header2: HeaderSchema,
  });

  const ClientMessageSchema = Data.Enum([
    Data.Object({ HeaderCase: Data.Tuple([HeaderSchema]) }),
    Data.Object({ MisbehaviourCase: Data.Tuple([MisbehaviourSchema]) }),
  ]);

  const SpendClientRedeemerSchema = Data.Enum([
    Data.Object({
      UpdateClient: Data.Object({ msg: ClientMessageSchema }),
    }),
    Data.Literal('Other'),
  ]);
  type TSpendClientRedeemer = Data.Static<typeof SpendClientRedeemerSchema>;
  const TSpendClientRedeemer = SpendClientRedeemerSchema as unknown as SpendClientRedeemer;
  return Data.to(spendClientRedeemer, TSpendClientRedeemer);
}

export function decodeSpendClientRedeemer(
  spendClientRedeemer: string,
  Lucid: typeof import('@cuonglv0297/lucid-custom'),
): SpendClientRedeemer {
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
    round: Data.Integer(),
    blockId: BlockIDSchema,
    signatures: Data.Array(CommitSigSchema),
  });
  const ConsensusSchema = Data.Object({
    block: Data.Integer(),
    app: Data.Integer(),
  });
  const TmHeaderSchema = Data.Object({
    version: ConsensusSchema,
    chainId: Data.Bytes(),
    height: Data.Integer(),
    time: Data.Integer(),
    lastBlockId: BlockIDSchema,
    lastCommitHash: Data.Bytes(),
    dataHash: Data.Bytes(),
    validatorsHash: Data.Bytes(),
    nextValidatorsHash: Data.Bytes(),
    consensusHash: Data.Bytes(),
    appHash: Data.Bytes(),
    lastResultsHash: Data.Bytes(),
    evidenceHash: Data.Bytes(),
    proposerAddress: Data.Bytes(),
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

  const MisbehaviourSchema = Data.Object({
    client_id: Data.Bytes(),
    header1: HeaderSchema,
    header2: HeaderSchema,
  });

  const ClientMessageSchema = Data.Enum([
    Data.Object({ HeaderCase: Data.Tuple([HeaderSchema]) }),
    Data.Object({ MisbehaviourCase: Data.Tuple([MisbehaviourSchema]) }),
  ]);

  const SpendClientRedeemerSchema = Data.Enum([
    Data.Object({
      UpdateClient: Data.Object({ msg: ClientMessageSchema }),
    }),
    Data.Literal('Other'),
  ]);
  type TSpendClientRedeemer = Data.Static<typeof SpendClientRedeemerSchema>;
  const TSpendClientRedeemer = SpendClientRedeemerSchema as unknown as SpendClientRedeemer;
  return Data.from(spendClientRedeemer, TSpendClientRedeemer);
}
