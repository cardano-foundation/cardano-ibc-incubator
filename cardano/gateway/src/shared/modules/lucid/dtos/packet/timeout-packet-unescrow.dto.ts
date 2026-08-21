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

export type UnsignedTimeoutPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferEscrowShard &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'timeoutPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  spendChannelAddress: string;
  transferModuleAddress: string;
  denomToken: string;
};
