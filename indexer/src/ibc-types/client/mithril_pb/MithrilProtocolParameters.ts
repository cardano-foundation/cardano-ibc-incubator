import {Data} from '../../plutus/data';
import {FractionSchema} from './Fraction';

export const MithrilProtocolParametersSchema = Data.Object({
  k: Data.Integer(),
  m: Data.Integer(),
  phi_f: Data.Nullable(FractionSchema),
});
export type MithrilProtocolParameters = Data.Static<typeof MithrilProtocolParametersSchema>;
export const MithrilProtocolParameters = MithrilProtocolParametersSchema as unknown as MithrilProtocolParameters;
