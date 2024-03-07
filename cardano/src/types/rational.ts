import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const RationalSchema = Data.Object({
  numerator: Data.Integer(),
  denominator: Data.Integer(),
});
export type Rational = Data.Static<typeof RationalSchema>;
export const Rational = RationalSchema as unknown as Rational;
