import {Data} from '../../../../../plutus/data';
import {PartSetHeaderSchema} from './PartSetHeader';

export const BlockIDSchema = Data.Object({
  hash: Data.Bytes(),
  part_set_header: PartSetHeaderSchema,
});
export type BlockID = Data.Static<typeof BlockIDSchema>;
export const BlockID = BlockIDSchema as unknown as BlockID;
