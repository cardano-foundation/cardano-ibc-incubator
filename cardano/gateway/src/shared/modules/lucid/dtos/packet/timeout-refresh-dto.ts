import { UTxO } from '@cuonglv0297/lucid-custom';

export type UnsignedTimeoutRefreshDto = {
  channelUtxo: UTxO;
  spendChannelRefUTxO: UTxO;
  encodedChannelDatum: string;
  encodedSpendChannelRedeemer: string;

  channelTokenUnit: string;
  constructedAddress: string;
};
