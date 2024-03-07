import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { ChannelStateSchema } from "./state.ts";
import { OrderSchema } from "./order.ts";
import { ChannelCounterpartySchema } from "./counterparty.ts";

export const ChannelSchema = Data.Object({
  state: ChannelStateSchema,
  ordering: OrderSchema,
  counterparty: ChannelCounterpartySchema,
  connection_hops: Data.Array(Data.Bytes()),
  version: Data.Bytes(),
});
export type Channel = Data.Static<typeof ChannelSchema>;
export const Channel = ChannelSchema as unknown as Channel;
