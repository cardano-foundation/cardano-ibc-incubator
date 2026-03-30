import { UTxO } from '@lucid-evolution/lucid';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelOpenInitDto = {
  constructedAddress: string;
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleKey: GatewayModuleKey;
  moduleUtxo: UTxO;
  encodedSpendModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedUpdatedHostStateDatum: string;
  encodedChannelDatum: string;
};
