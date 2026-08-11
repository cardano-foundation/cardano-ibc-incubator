import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintTransferEscrowShardRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferEscrowShard,
  WithRequiredTransferModuleReferenceUtxo,
  WithTransferModuleSpend,
  WithVerifyProof,
} from './fragments';

export type UnsignedAckPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferEscrowShard &
  WithMintTransferEscrowShardRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  denomToken: string;
};
