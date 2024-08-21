import { UTxO } from '@cuonglv0297/lucid-custom';

export type UnsignedChannelOpenTryDto = {
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  transferModuleUtxo: UTxO;
  spendHandlerRefUtxo: UTxO;
  mintChannelRefUtxo: UTxO;
  spendMockModuleRefUtxo: UTxO;
  encodedSpendMockModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedChannelDatum: string;
  constructedAddress: string;
};
