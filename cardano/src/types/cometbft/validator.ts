import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

/// Tendermint Header
export const ValidatorSchema = Data.Object({
  address: Data.Bytes(),
  pubkey: Data.Bytes(),
  votingPower: Data.Integer(),
  proposerPriority: Data.Integer(),
});
export type Validator = Data.Static<typeof ValidatorSchema>;
export const Validator = ValidatorSchema as unknown as Validator;
