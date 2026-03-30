import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintVoucherRedeemer,
  WithModuleContext,
  WithModuleSpend,
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

export type UnsignedRecvPacketModuleDto = WithHostStateUpdate &
  WithChannelContext &
  WithModuleContext &
  WithModuleSpend &
  WithChannelSpend &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof;

export type UnsignedRecvPacketMintDto = WithHostStateUpdate &
  WithChannelContext &
  WithTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithMintVoucherRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'recvPacketPolicyId'> &
  WithVerifyProof & {
    voucherTokenUnit: string;
    receiverAddress: string;
  };
