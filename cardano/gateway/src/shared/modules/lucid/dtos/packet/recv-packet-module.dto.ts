import type {
  WithChannelContext,
  WithChannelSpend,
  WithHostStateUpdate,
  WithModuleContext,
  WithModuleSpend,
  WithPacketPolicyAndChannelToken,
  WithVerifyProof,
} from './fragments';

export type UnsignedRecvPacketModuleDto = WithHostStateUpdate &
  WithChannelContext &
  WithModuleContext &
  WithModuleSpend &
  WithChannelSpend &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof;
