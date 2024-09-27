import {Data} from '../../plutus/data';

export const FractionSchema = Data.Object({
  numerator: Data.Integer(),
  denominator: Data.Integer(),
});
export type Fraction = Data.Static<typeof FractionSchema>;
export const Fraction = FractionSchema as unknown as Fraction;
