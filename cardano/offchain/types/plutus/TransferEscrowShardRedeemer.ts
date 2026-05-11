import { Data } from "@lucid-evolution/lucid";

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
    }),
  }),
  Data.Object({
    BurnEscrowShard: Data.Object({
      channel_id: Data.Bytes(),
      denom: Data.Bytes(),
    }),
  }),
]);
export type TransferEscrowShardRedeemer = Data.Static<
  typeof TransferEscrowShardRedeemerSchema
>;
export const TransferEscrowShardRedeemer =
  TransferEscrowShardRedeemerSchema as unknown as TransferEscrowShardRedeemer;
