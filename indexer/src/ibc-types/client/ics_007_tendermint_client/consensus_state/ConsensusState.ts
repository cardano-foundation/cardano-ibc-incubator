import {MerkleRootSchema} from '../../../core/ics_023_vector_commitments/merkle/MerkleRoot';
import {Data} from '../../../plutus/data';

export const ConsensusStateSchema = Data.Object({
  timestamp: Data.Integer(),
  next_validators_hash: Data.Bytes(),
  root: MerkleRootSchema,
});
export type ConsensusState = Data.Static<typeof ConsensusStateSchema>;
export const ConsensusState = ConsensusStateSchema as unknown as ConsensusState;
