import { UTxO, PolicyId } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedAckPacketUnescrowDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  transferModuleUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelDatum: string;
  transferAmount: bigint;
  senderAddress: string;
  constructedAddress: string;
  denomToken: string;

  ackPacketRefUTxO: UTxO;
  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};
