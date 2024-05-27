import { UTxO } from '@dinhbx/lucid-custom';
import { PolicyId } from 'lucid-cardano';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedAckPacketMintDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendTransferModuleRefUtxo: UTxO;
  transferModuleUtxo: UTxO;
  mintVoucherRefUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;
  voucherTokenUnit: string;
  transferAmount: bigint;
  senderAddress: string;
  denomToken: string;
  constructedAddress: string;

  ackPacketRefUTxO: UTxO;
  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};

export type UnsignedAckPacketMintDtoTwoModule = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendModuleRefUtxo: UTxO;
  moduleUtxo: UTxO;
  mintVoucherRefUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;
  voucherTokenUnit: string;
  amount: bigint;
  senderAddress: string;
  denomToken: string;
  constructedAddress: string;

  ackPacketRefUTxO: UTxO;
  ackPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};
