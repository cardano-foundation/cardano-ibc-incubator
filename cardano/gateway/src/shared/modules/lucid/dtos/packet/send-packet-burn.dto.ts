import { PolicyId, UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '@shared/types/auth-token';

export type UnsignedSendPacketBurnDto = {
  hostStateUtxo: UTxO;
  channelUTxO: UTxO;
  connectionUTxO: UTxO;
  clientUTxO: UTxO;
  transferModuleUTxO: UTxO;
  senderVoucherTokenUtxo: UTxO;

  encodedHostStateRedeemer: string;
  encodedUpdatedHostStateDatum: string;
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

  sendPacketPolicyId: PolicyId;
  channelToken: AuthToken;
};
