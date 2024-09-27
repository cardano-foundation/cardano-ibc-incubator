import {Data} from '../../../../plutus/data';

export const LeafOpSchema = Data.Object({
  hash: Data.Integer(),
  prehash_key: Data.Integer(),
  prehash_value: Data.Integer(),
  length: Data.Integer(),
  prefix: Data.Bytes(),
});
export type LeafOp = Data.Static<typeof LeafOpSchema>;
export const LeafOp = LeafOpSchema as unknown as LeafOp;
