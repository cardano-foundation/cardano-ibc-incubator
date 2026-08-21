import { UTxO } from '@lucid-evolution/lucid';
import {
  WithChannelSpend,
  WithConstructedAddress,
  WithHostStateUpdate,
  WithLegacyChannelContext,
  WithMintVoucherRedeemer,
  WithPacketPolicyAndChannelToken,
  WithTransferAmount,
  WithTransferModuleReferenceUtxo,
  WithTransferModuleSpend,
  WithUpdatedTransferModuleDatum,
} from './fragments';

export type UnsignedSendPacketBurnDto = WithHostStateUpdate &
  WithLegacyChannelContext &
  WithChannelSpend &
  WithMintVoucherRedeemer &
  WithTransferModuleReferenceUtxo &
  WithTransferModuleSpend &
  WithUpdatedTransferModuleDatum &
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
