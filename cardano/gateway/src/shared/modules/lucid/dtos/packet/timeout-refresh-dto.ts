import { UTxO } from '@dinhbx/lucid-custom';

export type UnsignedTimeoutRefreshDto = {
  channelUtxo: UTxO;
  spendChannelRefUTxO: UTxO;
  encodedChannelDatum: string;
  encodedSpendChannelRedeemer: string;

  channelTokenUnit: string;
  constructedAddress: string;
};
