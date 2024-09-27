import {LeafOpSchema} from './LeafOp';
import {InnerOpSchema} from './InnerOp';
import {Data} from '../../../../plutus/data';

export const ExistenceProofSchema = Data.Object({
  key: Data.Bytes(),
  value: Data.Bytes(),
  leaf: LeafOpSchema,
  path: Data.Array(InnerOpSchema),
});
export type ExistenceProof = Data.Static<typeof ExistenceProofSchema>;
export const ExistenceProof = ExistenceProofSchema as unknown as ExistenceProof;
