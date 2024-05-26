import { UTxO } from '@dinhbx/lucid-custom';
import { PolicyId } from 'lucid-cardano';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedAckPacketSucceedDto = {
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
  constructedAddress: string;

  ackPacketRefUTxO: UTxO;
  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};

export type UnsignedAckPacketSucceedForOrderedChannelDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendMockModuleRefUtxo: UTxO;
  mockModuleUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendMockModuleRedeemer: string;
  channelTokenUnit: string;
  encodedUpdatedChannelOrderedDatum: string;
  constructedAddress: string;

  ackPacketRefUTxO: UTxO;
  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};
