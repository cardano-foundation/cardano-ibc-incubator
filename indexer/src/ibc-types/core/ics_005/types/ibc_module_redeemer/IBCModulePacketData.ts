import {FungibleTokenPacketDataSchema} from '../../../../apps/transfer/types/fungible_token_packet_data/FungibleTokenPacketData';
import {Data} from '../../../../plutus/data';

export const IBCModulePacketDataSchema = Data.Enum([
  Data.Object({
    TransferModuleData: Data.Tuple([FungibleTokenPacketDataSchema]),
  }),
  Data.Object({
    TransferModuleData: Data.Tuple([FungibleTokenPacketDataSchema]),
  }),
  Data.Literal('OtherModuleData'),
]);
export type IBCModulePacketData = Data.Static<typeof IBCModulePacketDataSchema>;
export const IBCModulePacketData = IBCModulePacketDataSchema as unknown as IBCModulePacketData;
