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
  WithVerifyProof,
} from './fragments';

export type UnsignedRecvPacketDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof;

export type UnsignedRecvPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithMintVoucherRedeemer &
  WithOptionalTraceRegistryUpdate &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof & {
    voucherTokenUnit: string;
    receiverAddress: string;
  };
