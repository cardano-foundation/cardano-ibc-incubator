import { UTxO } from '@lucid-evolution/lucid';
import {
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithLegacyChannelContext,
  WithLegacyTransferModuleUtxo,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleSpend,
} from './fragments';

export type UnsignedSendPacketEscrowDto = WithHostStateUpdate &
  WithLegacyChannelContext &
  WithLegacyTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
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
