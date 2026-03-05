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

export type UnsignedAckPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  denomToken: string;
};
