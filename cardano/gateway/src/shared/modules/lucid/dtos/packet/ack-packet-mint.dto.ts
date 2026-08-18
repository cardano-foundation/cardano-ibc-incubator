import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintVoucherRedeemer,
  WithOptionalTraceRegistryUpdate,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithRequiredTransferModuleReferenceUtxo,
  WithTransferModuleSpend,
  WithVoucherMetadataOutput,
  WithVerifyProof,
} from './fragments';

// Operation DTOs are assembled from shared `With*` fragments plus only
// operation-specific fields to keep structural contracts consistent.
export type UnsignedAckPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithMintVoucherRedeemer &
  WithVoucherMetadataOutput &
  WithOptionalTraceRegistryUpdate &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferModuleSpend &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'ackPacketPolicyId'> &
  WithVerifyProof & {
  voucherTokenUnit: string;
  senderAddress: string;
};
