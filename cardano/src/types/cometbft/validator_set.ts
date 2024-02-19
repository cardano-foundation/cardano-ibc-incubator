import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { ValidatorSchema } from "./validator.ts";

/// Tendermint Header
export const ValidatorSetSchema = Data.Object({
  validators: Data.Array(ValidatorSchema),
  proposer: ValidatorSchema,
  totalVotingPower: Data.Integer(),
});
export type ValidatorSet = Data.Static<typeof ValidatorSetSchema>;
export const ValidatorSet = ValidatorSetSchema as unknown as ValidatorSet;
