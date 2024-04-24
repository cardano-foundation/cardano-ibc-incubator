import { UTxO } from '@dinhbx/lucid-custom';
import { PolicyId } from 'lucid-cardano';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedTimeoutPacketUnescrowDto = {
  spendChannelRefUtxo: UTxO;
  spendTransferModuleUtxo: UTxO;
  channelUtxo: UTxO;
  transferModuleUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  transferModuleAddress: string;
  denomToken: string;
  constructedAddress: string;

  timeoutPacketRefUTxO: UTxO;
  timeoutPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofRefUTxO: UTxO;
  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
