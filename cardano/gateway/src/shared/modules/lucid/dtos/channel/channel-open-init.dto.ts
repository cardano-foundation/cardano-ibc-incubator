import { UTxO } from '@lucid-evolution/lucid';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelOpenInitDto = {
  constructedAddress: string;
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleKey: GatewayModuleKey;
  moduleUtxo: UTxO;
  encodedSpendModuleRedeemer: string;
  encodedMintChannelRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedHostStateDatum: string;
  encodedChannelDatum: string;
};
