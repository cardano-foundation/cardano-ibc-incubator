import { UTxO } from '@lucid-evolution/lucid';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelOpenTryDto = {
  moduleKey: GatewayModuleKey;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleUtxo: UTxO;
  encodedSpendModuleRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHostStateDatum: string;
  encodedHostStateRedeemer: string;
  encodedChannelDatum: string;
  hostStateUtxo: UTxO;
};
