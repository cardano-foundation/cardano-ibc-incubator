import {Data} from '../../../../plutus/data';
import {CommitmentProof_ProofSchema} from './CommitmentProof_Proof';

export const CommitmentProofSchema = Data.Object({
  proof: CommitmentProof_ProofSchema,
});
export type CommitmentProof = Data.Static<typeof CommitmentProofSchema>;
export const CommitmentProof = CommitmentProofSchema as unknown as CommitmentProof;
