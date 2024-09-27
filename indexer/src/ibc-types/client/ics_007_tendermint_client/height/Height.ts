import {Data} from '../../../plutus/data';

export const HeightSchema = Data.Object({
  revision_number: Data.Integer(),
  revision_height: Data.Integer(),
});
export type Height = Data.Static<typeof HeightSchema>;
export const Height = HeightSchema as unknown as Height;
