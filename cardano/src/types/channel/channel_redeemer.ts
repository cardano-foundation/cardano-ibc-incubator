import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "../auth_token.ts";
import { HeightSchema } from "../height.ts";
import { PacketSchema } from "./packet.ts";

export const MintChannelRedeemerSchema = Data.Enum([
  Data.Object({
    ChanOpenInit: Data.Object({
      handler_token: AuthTokenSchema,
    }),
  }),
  Data.Object({
    ChanOpenTry: Data.Object({
      handler_token: AuthTokenSchema,
      counterparty_version: Data.Bytes(),
      proof_init: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
]);
export type MintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
export const MintChannelRedeemer =
  MintChannelRedeemerSchema as unknown as MintChannelRedeemer;

export const SpendChannelRedeemerSchema = Data.Enum([
  Data.Object({
    ChanOpenAck: Data.Object({
      counterparty_version: Data.Bytes(),
      proof_try: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
  Data.Object({
    ChanOpenConfirm: Data.Object({
      proof_ack: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
  Data.Object({
    RecvPacket: Data.Object({
      packet: PacketSchema,
      proof_commitment: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
]);
export type SpendChannelRedeemer = Data.Static<
  typeof SpendChannelRedeemerSchema
>;
export const SpendChannelRedeemer =
  SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
