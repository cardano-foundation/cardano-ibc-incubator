import { UTxO } from '@lucid-evolution/lucid';

export type UnsignedChannelOpenInitDto = {
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendHandlerRefUtxo: UTxO;
  mintChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  transferModuleUtxo: UTxO;
  encodedSpendTransferModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedChannelDatum: string;
  encodedNewTransferModuleDatum?: string;
  constructedAddress: string;
};

export type UnsignedOrderedChannelOpenInitDto = {
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendHandlerRefUtxo: UTxO;
  mintChannelRefUtxo: UTxO;
  spendMockModuleRefUtxo: UTxO;
  mockModuleUtxo: UTxO;
  encodedSpendMockModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedChannelDatum: string;
  encodedNewMockModuleDatum?: string;
  constructedAddress: string;
};
