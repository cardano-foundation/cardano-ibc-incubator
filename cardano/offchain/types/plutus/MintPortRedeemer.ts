import { Data } from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "./AuthToken.ts";

const FungibleTokenPacketDataSchema = Data.Object({
  denom: Data.Bytes(),
  amount: Data.Bytes(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  memo: Data.Bytes(),
});

export const MintPortRedeemerSchema = Data.Enum([
  Data.Object({
    BindPort: Data.Object({
      handler_token: AuthTokenSchema,
      spend_module_script_hash: Data.Bytes(),
      port_number: Data.Integer(),
    }),
  }),
  Data.Object({
    CreateEscrowShard: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
      data: FungibleTokenPacketDataSchema,
    }),
  }),
  Data.Object({
    BurnEscrowShard: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
    }),
  }),
]);
export type MintPortRedeemer = Data.Static<typeof MintPortRedeemerSchema>;
export const MintPortRedeemer =
  MintPortRedeemerSchema as unknown as MintPortRedeemer;
