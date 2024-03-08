import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const MerklePrefixSchema = Data.Object({
  key_prefix: Data.Bytes(),
});
export type MerklePrefix = Data.Static<typeof MerklePrefixSchema>;
export const MerklePrefix = MerklePrefixSchema as unknown as MerklePrefix;
