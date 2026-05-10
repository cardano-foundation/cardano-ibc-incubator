import { UTxO } from '@lucid-evolution/lucid';
import {
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithLegacyChannelContext,
  WithMintTransferEscrowShardRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferEscrowShard,
  WithTransferModuleSpend,
  WithTransferModuleReferenceUtxo,
} from './fragments';

export type UnsignedSendPacketEscrowDto = WithHostStateUpdate &
  WithLegacyChannelContext &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithTransferEscrowShard &
  WithMintTransferEscrowShardRedeemer &
  WithTransferModuleReferenceUtxo &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'sendPacketPolicyId'> & {
  senderAddress: string;
  receiverAddress: string;
  walletUtxos: UTxO[];
  spendChannelAddress: string;
  transferModuleAddress: string;
  denomToken: string;
};
