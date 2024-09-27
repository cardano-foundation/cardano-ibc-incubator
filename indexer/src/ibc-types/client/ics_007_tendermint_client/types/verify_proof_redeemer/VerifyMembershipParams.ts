import {ClientStateSchema} from '../../client_state/ClientState';
import {ConsensusStateSchema} from '../../consensus_state/ConsensusState';
import {HeightSchema} from '../../height/Height';
import {MerkleProofSchema} from '../../../../core/ics_023_vector_commitments/merkle/MerkleProof';
import {MerklePathSchema} from '../../../../core/ics_023_vector_commitments/merkle/MerklePath';
import {Data} from '../../../../plutus/data';

export const VerifyMembershipParamsSchema = Data.Object({
  cs: ClientStateSchema,
  cons_state: ConsensusStateSchema,
  height: HeightSchema,
  delay_time_period: Data.Integer(),
  delay_block_period: Data.Integer(),
  proof: MerkleProofSchema,
  path: MerklePathSchema,
  value: Data.Bytes(),
});
export type VerifyMembershipParams = Data.Static<typeof VerifyMembershipParamsSchema>;
export const VerifyMembershipParams = VerifyMembershipParamsSchema as unknown as VerifyMembershipParams;
