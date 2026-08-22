import { Data } from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "./AuthToken.ts";

const FungibleTokenPacketDataSchema = Data.Object({
  denom: Data.Bytes(),
  amount: Data.Bytes(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  memo: Data.Bytes(),
});

export const TransferEscrowShardRedeemerSchema = Data.Enum([
  Data.Object({
    CreateEscrowShard: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
      data: FungibleTokenPacketDataSchema,
      registry_siblings: Data.Array(Data.Bytes()),
    }),
  }),
  Data.Object({
    CreateEscrowShardV2: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
      data: FungibleTokenPacketDataSchema,
      registry_siblings: Data.Array(Data.Bytes()),
      old_channel_live_escrow_shard_count: Data.Integer(),
      channel_live_escrow_shard_count_siblings: Data.Array(Data.Bytes()),
    }),
  }),
  Data.Object({
    RetireEscrowShard: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
      registry_siblings: Data.Array(Data.Bytes()),
      old_channel_live_escrow_shard_count: Data.Integer(),
      channel_live_escrow_shard_count_siblings: Data.Array(Data.Bytes()),
      transfer_port_token: AuthTokenSchema,
    }),
  }),
]);
export type TransferEscrowShardRedeemer = Data.Static<
  typeof TransferEscrowShardRedeemerSchema
>;
export const TransferEscrowShardRedeemer =
  TransferEscrowShardRedeemerSchema as unknown as TransferEscrowShardRedeemer;
