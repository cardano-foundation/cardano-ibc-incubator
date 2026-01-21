import { UTxO, PolicyId } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedAckPacketSucceedDto = {
  hostStateUtxo: UTxO;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  transferModuleUtxo: UTxO;

  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelDatum: string;
  constructedAddress: string;

  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
