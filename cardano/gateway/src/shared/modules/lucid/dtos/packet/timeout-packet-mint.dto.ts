import { UTxO, PolicyId } from '@lucid-evolution/lucid';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedTimeoutPacketMintDto = {
  hostStateUtxo: UTxO;
  channelUtxo: UTxO;
  transferModuleUtxo: UTxO;
  connectionUtxo: UTxO;
  clientUtxo: UTxO;

  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
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

  timeoutPacketPolicyId: PolicyId;
  channelToken: AuthToken;

  verifyProofPolicyId: PolicyId;

  encodedVerifyProofRedeemer: string;
};
