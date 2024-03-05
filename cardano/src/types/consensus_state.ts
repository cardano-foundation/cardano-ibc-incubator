import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

const MerkleRootSchema = Data.Object({
  hash: Data.Bytes(),
});
export type MerkleRoot = Data.Static<typeof MerkleRootSchema>;
export const MerkleRoot = MerkleRootSchema as unknown as MerkleRoot;

export const ConsensusStateSchema = Data.Object({
  timestamp: Data.Integer(),
  next_validators_hash: Data.Bytes(),
  root: MerkleRootSchema,
});
export type ConsensusState = Data.Static<typeof ConsensusStateSchema>;
export const ConsensusState = ConsensusStateSchema as unknown as ConsensusState;
