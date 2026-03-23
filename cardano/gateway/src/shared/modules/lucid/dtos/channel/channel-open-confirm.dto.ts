import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';

export type UnsignedChannelOpenConfirmDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  mockModuleUtxo: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedSpendMockModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelDatum: string;
  encodedNewMockModuleDatum: string;
  constructedAddress: string;
  chanOpenConfirmPolicyId: PolicyId;
  channelToken: AuthToken;
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
