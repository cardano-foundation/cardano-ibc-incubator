import { UTxO } from '@lucid-evolution/lucid';
import { WithHostStateUpdate, WithTransferModuleSpend } from './fragments';

/** Inputs and witnesses for permanently retiring an empty escrow shard. */
export type UnsignedRetireTransferEscrowShardDto = WithHostStateUpdate &
  WithTransferModuleSpend & {
    transferModuleUtxo: UTxO;
    transferEscrowShardUtxo: UTxO;
    channelUtxo: UTxO;
    encodedUpdatedTransferModuleDatum: string;
    encodedMintTransferEscrowShardRedeemer: string;
    transferEscrowShardTokenUnit: string;
  };
