import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '@shared/types/auth-token';

export type UnsignedSendPacketEscrowDto = {
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  spendChannelRefUTxO: UTxO;
  spendTransferModuleUTxO: UTxO;
  transferModuleUTxO: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;
  receiverAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  transferModuleAddress: string;
  denomToken: string;

  constructedAddress: string;

  sendPacketRefUTxO: UTxO;
  sendPacketPolicyId: PolicyId;
  channelToken: AuthToken;
};

export type UnsignedSendPacketEscrowForOrderedChannelDto = {
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  spendChannelRefUTxO: UTxO;
  spendMockModuleUTxO: UTxO;
  mockModuleUTxO: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendModuleRedeemer: string;
  encodedUpdatedChannelDatum: string;

  transferAmount: bigint;
  senderAddress: string;
  receiverAddress: string;

  spendChannelAddress: string;
  channelTokenUnit: string;
  mockModuleAddress: string;
  denomToken: string;

  constructedAddress: string;

  sendPacketRefUTxO: UTxO;
  sendPacketPolicyId: PolicyId;
  channelToken: AuthToken;
};