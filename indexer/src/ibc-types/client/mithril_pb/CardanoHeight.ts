import {Data} from '../../plutus/data';

export const CardanoHeightSchema = Data.Object({
  revision_number: Data.Integer(),
  revision_height: Data.Integer(),
});
export type CardanoHeight = Data.Static<typeof CardanoHeightSchema>;
export const CardanoHeight = CardanoHeightSchema as unknown as CardanoHeight;
