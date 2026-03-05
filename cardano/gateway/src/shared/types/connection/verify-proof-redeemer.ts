import { Height } from '../height';
import { MerklePath, MerkleProof } from '../isc-23/merkle';
import { ConsensusState } from '../consensus-state';
import { VerifyMembershipParams } from './verify-membership-params';
import { ClientState } from '../client-state-types';
import {
  createConsensusStateSchema,
  createHeightSchema,
  createIcs23MerkleProofSchema,
  createMerklePathSchema,
  createTendermintClientStateSchema,
} from '../schema-fragments';

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
  const ClientStateSchema = createTendermintClientStateSchema(Data);
  const ConsensusStateSchema = createConsensusStateSchema(Data);
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);
  const MerklePathSchema = createMerklePathSchema(Data);

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

  return Data.to(verifyProofRedeemer, VerifyProofRedeemerSchema as unknown as VerifyProofRedeemer, { canonical: true });
}
