import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedRecvPacketDto = {
  hostStateUtxo: UTxO;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  encodedSpendChannelRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;

  constructedAddress: string;
  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};

export type UnsignedRecvPacketMintDto = {
  hostStateUtxo: UTxO;
  channelUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;
  transferModuleUtxo: UTxO;

  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;
  voucherTokenUnit: string;
  transferAmount: bigint;
  receiverAddress: string;
  constructedAddress: string;

  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;
  encodedVerifyProofRedeemer: string;
};
