import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintTransferEscrowShardRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferEscrowShard,
  WithTransferModuleSpend,
  WithVerifyProof,
} from './fragments';

export type UnsignedRecvPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferEscrowShard &
  WithMintTransferEscrowShardRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof & {
  denomToken: string;
  receiverAddress: string;
};
