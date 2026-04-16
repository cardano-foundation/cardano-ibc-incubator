import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithModuleContext,
  WithModuleSpend,
  WithPacketPolicyAndChannelToken,
  WithVerifyProof,
} from './fragments';

export type UnsignedAckPacketModuleDto = WithHostStateUpdate &
  WithChannelContext &
  WithModuleContext &
  WithModuleSpend &
  WithChannelSpend &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof;
