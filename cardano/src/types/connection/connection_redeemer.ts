import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AuthTokenSchema } from "../auth_token.ts";
import { HeightSchema } from "../height.ts";

export const MintConnectionRedeemerSchema = Data.Enum([
  Data.Object({
    ConnOpenInit: Data.Object({
      handler_auth_token: AuthTokenSchema,
    }),
  }),
  Data.Object({
    ConnOpenTry: Data.Object({
      handler_auth_token: AuthTokenSchema,
      client_state: Data.Bytes(),
      proof_init: Data.Bytes(),
      proof_client: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
]);
export type MintConnectionRedeemer = Data.Static<
  typeof MintConnectionRedeemerSchema
>;
export const MintConnectionRedeemer =
  MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;

export const SpendConnectionRedeemerSchema = Data.Enum([
  Data.Object({
    ConnOpenAck: Data.Object({
      counterparty_client_state: Data.Bytes(),
      proof_try: Data.Bytes(),
      proof_client: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
  Data.Object({
    ConnOpenConfirm: Data.Object({
      proof_ack: Data.Bytes(),
      proof_height: HeightSchema,
    }),
  }),
]);
export type SpendConnectionRedeemer = Data.Static<
  typeof SpendConnectionRedeemerSchema
>;
export const SpendConnectionRedeemer =
  SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
