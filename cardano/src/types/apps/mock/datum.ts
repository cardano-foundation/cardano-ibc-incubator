import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const MockModuleDatumSchema = Data.Object({
  opened_channels: Data.Map(Data.Bytes(), Data.Boolean()),
  received_packets: Data.Array(Data.Bytes()),
});
export type MockModuleDatum = Data.Static<typeof MockModuleDatumSchema>;
export const MockModuleDatum =
  MockModuleDatumSchema as unknown as MockModuleDatum;
