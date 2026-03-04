import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintVoucherRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleSpend,
  WithTransferModuleUtxo,
  WithVerifyProof,
} from './fragments';

// Operation DTOs are assembled from shared `With*` fragments plus only
// operation-specific fields to keep structural contracts consistent.
export type UnsignedAckPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithMintVoucherRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  voucherTokenUnit: string;
  senderAddress: string;
};
