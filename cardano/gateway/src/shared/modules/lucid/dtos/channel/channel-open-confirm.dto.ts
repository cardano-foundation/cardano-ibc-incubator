import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';
import { GatewayModuleKey } from '@shared/helpers/module-port';

export type UnsignedChannelOpenConfirmDto = {
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
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;
  chanOpenConfirmPolicyId: PolicyId;
  channelToken: AuthToken;
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
