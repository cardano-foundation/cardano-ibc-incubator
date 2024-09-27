import {Data} from '../../../plutus/data';
import {CommitmentProofSchema} from '../ics23/proofs/CommitmentProof';

export const MerkleProofSchema = Data.Object({
  proofs: Data.Array(CommitmentProofSchema),
});
export type MerkleProof = Data.Static<typeof MerkleProofSchema>;
export const MerkleProof = MerkleProofSchema as unknown as MerkleProof;
