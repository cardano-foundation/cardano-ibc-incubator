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

export type UnsignedRecvPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof & {
  denomToken: string;
  receiverAddress: string;
};
