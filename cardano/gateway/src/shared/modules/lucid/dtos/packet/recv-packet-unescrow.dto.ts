import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithPacketPolicyAndChannelToken,
  WithRequiredTransferModuleReferenceUtxo,
  WithTransferAmount,
  WithTransferEscrowShard,
  WithTransferModuleSpend,
  WithVerifyProof,
} from './fragments';

export type UnsignedRecvPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferModuleSpend &
  WithTransferEscrowShard &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof & {
  denomToken: string;
  receiverAddress: string;
};
