import {Data} from '../../../../plutus/data';
import {ExistenceProofSchema} from './ExistenceProof';
import {NonExistenceProofSchema} from './NonExistenceProof';

export const CommitmentProof_ProofSchema = Data.Enum([
  Data.Object({
    CommitmentProof_Exist: Data.Object({exist: ExistenceProofSchema}),
  }),
  Data.Object({
    CommitmentProof_Exist: Data.Object({exist: ExistenceProofSchema}),
  }),
  Data.Object({
    CommitmentProof_Nonexist: Data.Object({
      non_exist: NonExistenceProofSchema,
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
export type CommitmentProof_Proof = Data.Static<typeof CommitmentProof_ProofSchema>;
export const CommitmentProof_Proof = CommitmentProof_ProofSchema as unknown as CommitmentProof_Proof;
