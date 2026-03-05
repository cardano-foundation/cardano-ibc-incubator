import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithPacketPolicyAndChannelToken,
  WithTransferModuleSpend,
  WithTransferModuleUtxo,
  WithVerifyProof,
} from './fragments';

export type UnsignedAckPacketSucceedDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof;
