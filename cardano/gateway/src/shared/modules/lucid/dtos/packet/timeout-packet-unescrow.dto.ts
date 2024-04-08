import { UTxO } from '@dinhbx/lucid-custom';

export type UnsignedTimeoutPacketUnescrowDto = {
  spendChannelRefUtxo: UTxO;
  spendTransferModuleUtxo: UTxO;
  channelUtxo: UTxO;
  transferModuleUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  transferModuleAddress: string;
  denomToken: string;
  constructedAddress: string;
};
