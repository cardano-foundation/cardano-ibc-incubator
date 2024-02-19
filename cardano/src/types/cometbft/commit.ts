import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const PartSetHeaderSchema = Data.Object({
  total: Data.Integer(),
  hash: Data.Bytes(),
});
export type PartSetHeader = Data.Static<typeof PartSetHeaderSchema>;
export const PartSetHeader = PartSetHeaderSchema as unknown as PartSetHeader;

export const BlockIDSchema = Data.Object({
  hash: Data.Bytes(),
  partSetHeader: PartSetHeaderSchema,
});
export type BlockID = Data.Static<typeof BlockIDSchema>;
export const BlockID = BlockIDSchema as unknown as BlockID;

export const CommitSchema = Data.Object({
  height: Data.Integer(),
  blockId: BlockIDSchema,
  signatures: Data.Array(Data.Bytes()),
});
export type Commit = Data.Static<typeof CommitSchema>;
export const Commit = CommitSchema as unknown as Commit;
