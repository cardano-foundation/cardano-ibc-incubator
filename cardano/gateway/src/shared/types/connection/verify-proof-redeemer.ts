import { Data } from '@lucid-evolution/lucid';
import { Height } from '../height';
import { MerklePath, MerkleProof } from '../isc-23/merkle';
import { ConsensusState } from '../consensus-state';
import { VerifyMembershipParams } from './verify-membership-params';
import { ClientState } from '../client-state-types';

export type VerifyProofRedeemer =
  | {
      VerifyMembership: {
        cs: ClientState;
        cons_state: ConsensusState;
        height: Height;
        delay_time_period: bigint;
        delay_block_period: bigint;
        proof: MerkleProof;
        path: MerklePath;
        value: string;
      };
    }
  | {
      VerifyNonMembership: {
        cs: ClientState;
        cons_state: ConsensusState;
        height: Height;
        delay_time_period: bigint;
        delay_block_period: bigint;
        proof: MerkleProof;
        path: MerklePath;
      };
    }
  | {
      BatchVerifyMembership: [VerifyMembershipParams[]];
    }
  | 'VerifyOther';

export function encodeVerifyProofRedeemer(
  verifyProofRedeemer: VerifyProofRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;

  const RationalSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const LeaftOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerSpecSchema = Data.Object({
    child_order: Data.Array(Data.Integer()),
    child_size: Data.Integer(),
    min_prefix_length: Data.Integer(),
    max_prefix_length: Data.Integer(),
    empty_child: Data.Bytes(),
    hash: Data.Integer(),
  });
  const ProofSpecSchema = Data.Object({
    leaf_spec: LeaftOpSchema,
    inner_spec: InnerSpecSchema,
    max_depth: Data.Integer(),
    min_depth: Data.Integer(),
    prehash_key_before_comparison: Data.Boolean(),
  });
  const ClientStateSchema = Data.Object({
    chainId: Data.Bytes(),
    trustLevel: RationalSchema,
    trustingPeriod: Data.Integer(),
    unbondingPeriod: Data.Integer(),
    maxClockDrift: Data.Integer(),
    frozenHeight: HeightSchema,
    latestHeight: HeightSchema,
    proofSpecs: Data.Array(ProofSpecSchema),
  });

  const MerkleRootSchema = Data.Object({
    hash: Data.Bytes(),
  });
  const ConsensusStateSchema = Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: MerkleRootSchema,
  });

  const LeafOpSchema = Data.Object({
    hash: Data.Integer(),
    prehash_key: Data.Integer(),
    prehash_value: Data.Integer(),
    length: Data.Integer(),
    prefix: Data.Bytes(),
  });
  const InnerOpSchema = Data.Object({
    hash: Data.Integer(),
    prefix: Data.Bytes(),
    suffix: Data.Bytes(),
  });
  const ExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    value: Data.Bytes(),
    leaf: LeafOpSchema,
    path: Data.Array(InnerOpSchema),
  });
  const NonExistenceProofSchema = Data.Object({
    key: Data.Bytes(),
    left: ExistenceProofSchema,
    right: ExistenceProofSchema,
  });
  const CommitmentProof_ProofSchema = Data.Enum([
    Data.Object({
      CommitmentProof_Exist: Data.Object({
        exist: ExistenceProofSchema,
      }),
    }),
    Data.Object({
      CommitmentProof_Nonexist: Data.Object({
        non_exist: NonExistenceProofSchema,
      }),
    }),
    Data.Literal('CommitmentProof_Batch'),
    Data.Literal('CommitmentProof_Compressed'),
  ]);
  const CommitmentProofSchema = Data.Object({
    proof: CommitmentProof_ProofSchema,
  });
  const MerkleProofSchema = Data.Object({
    proofs: Data.Array(CommitmentProofSchema),
  });

  const MerklePathSchema = Data.Object({
    key_path: Data.Array(Data.Bytes()),
  });

  const VerifyMembershipParamsSchema = Data.Object({
    cs: ClientStateSchema,
    cons_state: ConsensusStateSchema,
    height: HeightSchema,
    delay_time_period: Data.Integer(),
    delay_block_period: Data.Integer(),
    proof: MerkleProofSchema,
    path: MerklePathSchema,
    value: Data.Bytes(),
  });

  const VerifyProofRedeemerSchema = Data.Enum([
    Data.Object({
      VerifyMembership: Data.Object({
        cs: ClientStateSchema,
        cons_state: ConsensusStateSchema,
        height: HeightSchema,
        delay_time_period: Data.Integer(),
        delay_block_period: Data.Integer(),
        proof: MerkleProofSchema,
        path: MerklePathSchema,
        value: Data.Bytes(),
      }),
    }),
    Data.Object({
      VerifyNonMembership: Data.Object({
        cs: ClientStateSchema,
        cons_state: ConsensusStateSchema,
        height: HeightSchema,
        delay_time_period: Data.Integer(),
        delay_block_period: Data.Integer(),
        proof: MerkleProofSchema,
        path: MerklePathSchema,
      }),
    }),
    Data.Object({
      BatchVerifyMembership: Data.Tuple([Data.Array(VerifyMembershipParamsSchema)]),
    }),
    Data.Literal('VerifyOther'),
  ]);
  type TVerifyProofRedeemer = Data.Static<typeof VerifyProofRedeemerSchema>;
  const TVerifyProofRedeemer = VerifyProofRedeemerSchema as unknown as VerifyProofRedeemer;
  return Data.to(verifyProofRedeemer, TVerifyProofRedeemer, { canonical: true });
}
