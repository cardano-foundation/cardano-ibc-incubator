import { UTxO } from '@dinhbx/lucid-custom';

export type UnsignedConnectionOpenInitDto = {
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