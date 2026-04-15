import {
  WithChannelContext,
  WithChannelSpend,
  WithHostStateUpdate,
  WithModuleContext,
  WithModuleSpend,
  WithPacketPolicyAndChannelToken,
} from './fragments';

export type UnsignedSendPacketModuleDto = WithHostStateUpdate &
  WithChannelContext &
  WithModuleContext &
  WithModuleSpend &
  WithChannelSpend &
  WithPacketPolicyAndChannelToken<'sendPacketPolicyId'>;
