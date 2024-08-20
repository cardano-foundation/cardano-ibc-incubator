import { PolicyId, UTxO } from '@cuonglv0297/lucid-custom';
import { AuthToken } from '@shared/types/auth-token';

export type UnsignedSendPacketBurnDto = {
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  spendChannelRefUTxO: UTxO;
  spendTransferModuleUTxO: UTxO;
  transferModuleUTxO: UTxO;
  mintVoucherRefUtxo: UTxO;
  senderVoucherTokenUtxo: UTxO;

  encodedSpendChannelRedeemer: string;
  encodedSpendTransferModuleRedeemer: string;
  encodedMintVoucherRedeemer: string;
  encodedUpdatedChannelDatum: string;

  channelTokenUnit: string;
  voucherTokenUnit: string;

  senderAddress: string;
  receiverAddress: string;
  transferAmount: bigint;
  denomToken: string;

  constructedAddress: string;

  sendPacketRefUTxO: UTxO;
  sendPacketPolicyId: PolicyId;
  channelToken: AuthToken;
};
