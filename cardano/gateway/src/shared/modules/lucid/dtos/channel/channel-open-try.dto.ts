import { UTxO } from '@lucid-evolution/lucid';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelOpenTryDto = {
  moduleKey: GatewayModuleKey;
  handlerUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleUtxo: UTxO;
  encodedSpendModuleRedeemer: string;
  encodedSpendHandlerRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHandlerDatum: string;
  encodedUpdatedHostStateDatum: string;
  encodedHostStateRedeemer: string;
  encodedChannelDatum: string;
  hostStateUtxo: UTxO;
};
