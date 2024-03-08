import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export const ChannelCounterpartySchema = Data.Object({
  port_id: Data.Bytes(),
  channel_id: Data.Bytes(),
});
export type ChannelCounterparty = Data.Static<typeof ChannelCounterpartySchema>;
export const ChannelCounterparty =
  ChannelCounterpartySchema as unknown as ChannelCounterparty;
