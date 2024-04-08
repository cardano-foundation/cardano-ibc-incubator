import { UTxO } from '@dinhbx/lucid-custom';

export type UnsignedTimeoutPacketMintDto = {
  spendChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  mintVoucherRefUtxo: UTxO;
  channelUtxo: UTxO;
  transferModuleUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  transferModuleAddress: string;
  voucherTokenUnit: string;
  constructedAddress: string;
};
