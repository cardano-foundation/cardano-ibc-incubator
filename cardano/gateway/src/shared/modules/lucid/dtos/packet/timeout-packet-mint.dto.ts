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
  WithUpdatedTransferModuleDatum,
  WithVoucherMetadataOutput,
  WithVerifyProof,
} from './fragments';

export type UnsignedTimeoutPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithMintVoucherRedeemer &
  WithVoucherMetadataOutput &
  WithOptionalTraceRegistryUpdate &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferModuleSpend &
  WithUpdatedTransferModuleDatum &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'timeoutPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  spendChannelAddress: string;
  voucherTokenUnit: string;
};
