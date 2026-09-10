import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelCloseConfirmDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  moduleKey: GatewayModuleKey;
  moduleUtxo: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedSpendModuleRedeemer: string;
  channelTokenUnit: string;
  channelToken: AuthToken;
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;
  channelCloseConfirmPolicyId: PolicyId;
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
