import {Data} from '../../../plutus/data';
import {FungibleTokenPacketDataSchema} from '../types/fungible_token_packet_data/FungibleTokenPacketData.js';

export const TransferModuleRedeemerSchema = Data.Enum([
  Data.Object({
    Transfer: Data.Object({
      channel_id: Data.Bytes(),
      data: FungibleTokenPacketDataSchema,
    }),
  }),
  Data.Object({
    Transfer: Data.Object({
      channel_id: Data.Bytes(),
      data: FungibleTokenPacketDataSchema,
    }),
  }),
  Data.Literal('OtherTransferOp'),
]);
export type TransferModuleRedeemer = Data.Static<typeof TransferModuleRedeemerSchema>;
export const TransferModuleRedeemer = TransferModuleRedeemerSchema as unknown as TransferModuleRedeemer;
