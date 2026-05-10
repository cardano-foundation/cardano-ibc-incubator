import { UTxO } from '@lucid-evolution/lucid';
import {
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithLegacyChannelContext,
  WithMintVoucherRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
} from './fragments';

export type UnsignedSendPacketBurnDto = WithHostStateUpdate &
  WithLegacyChannelContext &
  WithChannelSpend &
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
