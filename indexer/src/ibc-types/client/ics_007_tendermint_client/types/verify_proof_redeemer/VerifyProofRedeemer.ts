import {ClientStateSchema} from '../../client_state/ClientState';
import {ConsensusStateSchema} from '../../consensus_state/ConsensusState';
import {HeightSchema} from '../../height/Height';
import {MerkleProofSchema} from '../../../../core/ics_023_vector_commitments/merkle/MerkleProof';
import {MerklePathSchema} from '../../../../core/ics_023_vector_commitments/merkle/MerklePath';
import {VerifyMembershipParamsSchema} from './VerifyMembershipParams';
import {Data} from '../../../../plutus/data';

export const VerifyProofRedeemerSchema = Data.Enum([
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
export type VerifyProofRedeemer = Data.Static<typeof VerifyProofRedeemerSchema>;
export const VerifyProofRedeemer = VerifyProofRedeemerSchema as unknown as VerifyProofRedeemer;
