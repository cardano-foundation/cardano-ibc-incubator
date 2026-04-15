import { UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelCloseInitDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;

  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleKey: GatewayModuleKey;
  moduleUtxo: UTxO;

  channelCloseInitPolicyId: string;
  encodedSpendChannelRedeemer: string;
  encodedSpendModuleRedeemer: string;
  channelTokenUnit: string;
  channelToken: AuthToken;
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;
};
