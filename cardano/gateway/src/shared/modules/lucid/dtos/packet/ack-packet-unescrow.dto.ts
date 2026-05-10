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

export type UnsignedAckPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferEscrowShard &
  WithMintTransferEscrowShardRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  denomToken: string;
};
