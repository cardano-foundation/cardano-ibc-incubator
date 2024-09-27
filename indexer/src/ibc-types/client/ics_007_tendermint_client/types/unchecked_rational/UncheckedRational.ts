import {Data} from '../../../../plutus/data';

export const UncheckedRationalSchema = Data.Object({
  numerator: Data.Integer(),
  denominator: Data.Integer(),
});
export type UncheckedRational = Data.Static<typeof UncheckedRationalSchema>;
export const UncheckedRational = UncheckedRationalSchema as unknown as UncheckedRational;
