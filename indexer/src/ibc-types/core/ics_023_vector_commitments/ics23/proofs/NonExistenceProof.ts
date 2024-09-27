import {Data} from '../../../../plutus/data';
import {ExistenceProofSchema} from './ExistenceProof';

export const NonExistenceProofSchema = Data.Object({
  key: Data.Bytes(),
  left: ExistenceProofSchema,
  right: ExistenceProofSchema,
});
export type NonExistenceProof = Data.Static<typeof NonExistenceProofSchema>;
export const NonExistenceProof = NonExistenceProofSchema as unknown as NonExistenceProof;
