import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithPacketPolicyAndChannelToken,
  WithRequiredTransferModuleReferenceUtxo,
  WithTransferModuleSpend,
  WithVerifyProof,
} from './fragments';

export type UnsignedAckPacketSucceedDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferModuleSpend &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof;
