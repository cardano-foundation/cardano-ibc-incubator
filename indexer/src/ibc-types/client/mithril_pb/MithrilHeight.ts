import {Data} from '../../plutus/data';

export const MithrilHeightSchema = Data.Object({
  mithril_height: Data.Integer(),
});
export type MithrilHeight = Data.Static<typeof MithrilHeightSchema>;
export const MithrilHeight = MithrilHeightSchema as unknown as MithrilHeight;
