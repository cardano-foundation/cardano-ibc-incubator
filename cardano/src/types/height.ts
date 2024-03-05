import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const HeightSchema = Data.Object({
  revisionNumber: Data.Integer(),
  revisionHeight: Data.Integer(),
});
export type Height = Data.Static<typeof HeightSchema>;
export const Height = HeightSchema as unknown as Height;
