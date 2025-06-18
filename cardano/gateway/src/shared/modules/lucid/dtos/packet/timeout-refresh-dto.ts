import { UTxO } from '@lucid-evolution/lucid';

export type UnsignedTimeoutRefreshDto = {
  channelUtxo: UTxO;
  encodedChannelDatum: string;
  encodedSpendChannelRedeemer: string;

  channelTokenUnit: string;
  constructedAddress: string;
};
