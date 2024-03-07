import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const VersionSchema = Data.Object({
  identifier: Data.Bytes(),
  features: Data.Array(Data.Bytes()),
});
export type Version = Data.Static<typeof VersionSchema>;
export const Version = VersionSchema as unknown as Version;
