import {
  WithChannelContext,
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithMintTransferEscrowShardRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferEscrowShard,
  WithRequiredTransferModuleReferenceUtxo,
  WithTransferModuleSpend,
  WithVerifyProof,
} from './fragments';

export type UnsignedTimeoutPacketUnescrowDto = WithHostStateUpdate &
  WithChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithRequiredTransferModuleReferenceUtxo &
  WithTransferEscrowShard &
  WithMintTransferEscrowShardRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'timeoutPacketPolicyId'> &
  WithVerifyProof & {
  senderAddress: string;
  spendChannelAddress: string;
  transferModuleAddress: string;
  denomToken: string;
};
