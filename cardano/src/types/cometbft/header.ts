import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

/// Tendermint Header
export const TmHeaderSchema = Data.Object({
  chainId: Data.Bytes(),
  height: Data.Integer(),
  time: Data.Integer(),
  validatorsHash: Data.Bytes(),
  nextValidatorsHash: Data.Bytes(),
  appHash: Data.Bytes(),
});
export type TmHeader = Data.Static<typeof TmHeaderSchema>;
export const TmHeader = TmHeaderSchema as unknown as TmHeader;
