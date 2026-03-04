import { UTxO } from '@lucid-evolution/lucid';
import {
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithLegacyChannelContext,
  WithLegacyTransferModuleUtxo,
  WithMintVoucherRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleSpend,
} from './fragments';

export type UnsignedSendPacketBurnDto = WithHostStateUpdate &
  WithLegacyChannelContext &
  WithLegacyTransferModuleUtxo &
  WithChannelSpend &
  WithTransferModuleSpend &
  WithMintVoucherRedeemer &
  WithTransferAmount &
  WithConstructedAddress &
  WithPacketPolicyAndChannelToken<'sendPacketPolicyId'> & {
  senderVoucherTokenUtxo: UTxO;
  walletUtxos?: UTxO[];
  voucherTokenUnit: string;
  senderAddress: string;
  receiverAddress: string;
  denomToken: string;
};
