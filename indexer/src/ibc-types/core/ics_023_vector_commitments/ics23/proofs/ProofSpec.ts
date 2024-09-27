import {LeafOpSchema} from './LeafOp';
import {InnerSpecSchema} from './InnerSpec';
import {Data} from '../../../../plutus/data';

export const ProofSpecSchema = Data.Object({
  leaf_spec: LeafOpSchema,
  inner_spec: InnerSpecSchema,
  max_depth: Data.Integer(),
  min_depth: Data.Integer(),
  prehash_key_before_comparison: Data.Boolean(),
});
export type ProofSpec = Data.Static<typeof ProofSpecSchema>;
export const ProofSpec = ProofSpecSchema as unknown as ProofSpec;
