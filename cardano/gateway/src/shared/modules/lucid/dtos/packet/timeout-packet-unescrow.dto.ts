import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleSpend,
  WithTransferModuleUtxo,
  WithVerifyProof,
} from './fragments';

export type UnsignedTimeoutPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'timeoutPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  spendChannelAddress: string;
  transferModuleAddress: string;
  denomToken: string;
};
