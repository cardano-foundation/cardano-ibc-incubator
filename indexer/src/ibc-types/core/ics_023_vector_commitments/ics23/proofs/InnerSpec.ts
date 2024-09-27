import {Data} from '../../../../plutus/data';

export const InnerSpecSchema = Data.Object({
  child_order: Data.Array(Data.Integer()),
  child_size: Data.Integer(),
  min_prefix_length: Data.Integer(),
  max_prefix_length: Data.Integer(),
  empty_child: Data.Bytes(),
  hash: Data.Integer(),
});
export type InnerSpec = Data.Static<typeof InnerSpecSchema>;
export const InnerSpec = InnerSpecSchema as unknown as InnerSpec;
