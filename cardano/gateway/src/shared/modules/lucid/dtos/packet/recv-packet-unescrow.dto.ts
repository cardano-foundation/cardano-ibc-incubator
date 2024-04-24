import { PolicyId, UTxO } from '@dinhbx/lucid-custom';
import { AuthToken } from '../../../../types/auth-token';

export type UnsignedRecvPacketUnescrowDto = {
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
  transferAmount: bigint;
  receiverAddress: string;
  constructedAddress: string;

  recvPacketRefUTxO: UTxO;
  recvPacketPolicyId: PolicyId;
  channelToken: AuthToken;
};
