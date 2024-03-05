import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { TmHeaderSchema } from "./header.ts";
import { CommitSchema } from "./commit.ts";

export const SignedHeaderSchema = Data.Object({
  header: TmHeaderSchema,
  commit: CommitSchema,
});
export type SignedHeader = Data.Static<typeof SignedHeaderSchema>;
export const SignedHeader = SignedHeaderSchema as unknown as SignedHeader;
