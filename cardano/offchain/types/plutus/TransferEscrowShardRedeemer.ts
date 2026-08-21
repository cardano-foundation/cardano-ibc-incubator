import { Data } from "@lucid-evolution/lucid";

const FungibleTokenPacketDataSchema = Data.Object({
  denom: Data.Bytes(),
  amount: Data.Bytes(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  memo: Data.Bytes(),
});

export const TransferEscrowShardRedeemerSchema = Data.Object({
  channel_id: Data.Bytes(),
  denom: Data.Bytes(),
  data: FungibleTokenPacketDataSchema,
  registry_siblings: Data.Array(Data.Bytes()),
});
export type TransferEscrowShardRedeemer = Data.Static<
  typeof TransferEscrowShardRedeemerSchema
>;
export const TransferEscrowShardRedeemer =
  TransferEscrowShardRedeemerSchema as unknown as TransferEscrowShardRedeemer;
