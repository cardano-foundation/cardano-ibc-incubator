import {
  WithChannelContext,
  WithChannelSpend,
  WithHostStateUpdate,
  WithPacketPolicyAndChannelToken,
  WithVerifyProof,
} from './fragments';

export type UnsignedPrunePacketHistoryDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithPacketPolicyAndChannelToken<'prunePacketHistoryPolicyId'> &
  WithVerifyProof;
