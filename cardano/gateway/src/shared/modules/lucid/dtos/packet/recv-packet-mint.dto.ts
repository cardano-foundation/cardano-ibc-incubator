import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedRecvPacketDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;

  constructedAddress: string;
  recvPacketRefUTxO: UTxO;
  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};

export type UnsignedRecvPacketMintDto = {
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
  receiverAddress: string;
  constructedAddress: string;

  recvPacketRefUTxO: UTxO;
  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};

export type UnsignedRecvPacketMintForOrderedChannelDto = {
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  spendChannelRefUtxo: UTxO;
  spendMockModuleRefUtxo: UTxO;
  mockModuleUtxo: UTxO;
  mintVoucherRefUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendMockModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;
  voucherTokenUnit: string;
  transferAmount: bigint;
  receiverAddress: string;
  constructedAddress: string;

  recvPacketRefUTxO: UTxO;
  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  verifyProofRefUTxO: UTxO;
  encodedVerifyProofRedeemer: string;
};
