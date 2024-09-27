import {Data} from '../../../../plutus/data';

export const FungibleTokenPacketDataSchema = Data.Object({
  denom: Data.Bytes(),
  amount: Data.Bytes(),
  sender: Data.Bytes(),
  receiver: Data.Bytes(),
  memo: Data.Bytes(),
});
export type FungibleTokenPacketData = Data.Static<typeof FungibleTokenPacketDataSchema>;
export const FungibleTokenPacketData = FungibleTokenPacketDataSchema as unknown as FungibleTokenPacketData;
