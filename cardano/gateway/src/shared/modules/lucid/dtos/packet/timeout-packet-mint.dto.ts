import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintVoucherRedeemer,
  WithOptionalTraceRegistryUpdate,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithVoucherMetadataOutput,
  WithVerifyProof,
} from './fragments';

export type UnsignedTimeoutPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithMintVoucherRedeemer &
  WithVoucherMetadataOutput &
  WithOptionalTraceRegistryUpdate &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'timeoutPacketPolicyId'> &
  WithVerifyProof & {
  voucherPolicyId?: string;
  senderAddress: string;
  spendChannelAddress: string;
  voucherTokenUnit: string;
};
