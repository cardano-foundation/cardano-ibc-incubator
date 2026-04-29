import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintVoucherRedeemer,
  WithOptionalTraceRegistryUpdate,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleSpend,
  WithTransferModuleUtxo,
  WithVoucherMetadataOutput,
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
  WithVoucherMetadataOutput &
  WithOptionalTraceRegistryUpdate &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  voucherTokenUnit: string;
  senderAddress: string;
};
