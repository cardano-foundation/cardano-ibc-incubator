import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedRecvPacketUnescrowDto = {
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
  transferAmount: bigint;
  receiverAddress: string;
  constructedAddress: string;

  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
