import { UTxO } from '@dinhbx/lucid-custom';
import { PolicyId } from 'lucid-cardano';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedTimeoutPacketMintDto = {
  spendChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  mintVoucherRefUtxo: UTxO;
  channelUtxo: UTxO;
  transferModuleUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  transferModuleAddress: string;
  voucherTokenUnit: string;
  constructedAddress: string;

  timeoutPacketRefUTxO: UTxO;
  timeoutPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofRefUTxO: UTxO;
  verifyProofPolicyId: PolicyId;

  encodedVerifyProofRedeemer: string;
};
