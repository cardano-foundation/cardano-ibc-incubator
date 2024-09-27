import {Data} from '../../../../../plutus/data';

export const PartSetHeaderSchema = Data.Object({
  total: Data.Integer(),
  hash: Data.Bytes(),
});
export type PartSetHeader = Data.Static<typeof PartSetHeaderSchema>;
export const PartSetHeader = PartSetHeaderSchema as unknown as PartSetHeader;
