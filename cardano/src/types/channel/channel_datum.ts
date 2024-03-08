import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "../auth_token.ts";
import { ChannelSchema } from "./channel.ts";

export const ChannelDatumStateSchema = Data.Object({
  channel: ChannelSchema,
  next_sequence_send: Data.Integer(),
  next_sequence_recv: Data.Integer(),
  next_sequence_ack: Data.Integer(),
  packet_commitment: Data.Map(Data.Integer(), Data.Bytes()),
  packet_receipt: Data.Map(Data.Integer(), Data.Bytes()),
  packet_acknowledgement: Data.Map(Data.Integer(), Data.Bytes()),
});
export type ChannelDatumState = Data.Static<typeof ChannelDatumStateSchema>;
export const ChannelDatumState =
  ChannelDatumStateSchema as unknown as ChannelDatumState;

export const ChannelDatumSchema = Data.Object({
  state: ChannelDatumStateSchema,
  port_id: Data.Bytes(),
  token: AuthTokenSchema,
});
export type ChannelDatum = Data.Static<typeof ChannelDatumSchema>;
export const ChannelDatum = ChannelDatumSchema as unknown as ChannelDatum;
