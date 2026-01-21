import { UTxO } from '@lucid-evolution/lucid';

export type UnsignedChannelOpenInitDto = {
  constructedAddress: string;
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  transferModuleUtxo: UTxO;
  encodedSpendTransferModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedUpdatedHostStateDatum: string;
  encodedChannelDatum: string;
  encodedNewTransferModuleDatum?: string;
};
