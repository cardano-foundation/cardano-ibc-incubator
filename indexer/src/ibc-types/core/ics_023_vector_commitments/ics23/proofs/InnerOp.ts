import {Data} from '../../../../plutus/data';

export const InnerOpSchema = Data.Object({
  hash: Data.Integer(),
  prefix: Data.Bytes(),
  suffix: Data.Bytes(),
});
export type InnerOp = Data.Static<typeof InnerOpSchema>;
export const InnerOp = InnerOpSchema as unknown as InnerOp;
