import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
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
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  denomToken: string;
};
