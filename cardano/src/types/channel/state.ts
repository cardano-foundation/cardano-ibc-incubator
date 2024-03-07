import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const ChannelStateSchema = Data.Enum([
  Data.Literal("Uninitialized"),
  Data.Literal("Init"),
  Data.Literal("TryOpen"),
  Data.Literal("Open"),
  Data.Literal("Close"),
]);
export type ChannelState = Data.Static<typeof ChannelStateSchema>;
export const ChannelState = ChannelStateSchema as unknown as ChannelState;
