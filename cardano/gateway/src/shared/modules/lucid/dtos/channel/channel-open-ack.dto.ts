import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';

export type UnsignedChannelOpenAckDto = {
  hostStateUtxo: UTxO;
  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  transferModuleUtxo: UTxO;
  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;
  chanOpenAckPolicyId: PolicyId;
  channelToken: AuthToken;
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
