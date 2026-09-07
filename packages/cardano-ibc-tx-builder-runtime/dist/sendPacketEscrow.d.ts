import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import type { UnsignedSendPacketEscrowTxInput } from '@cardano-ibc/tx-builder';
export type SendPacketEscrowDependencies = {
    newTx: () => TxBuilder;
    hostStateAddress: string | undefined;
    hostStateTokenUnit: string;
    transferModuleRootAddress: string;
    referenceScripts: {
        spendChannel: UTxO;
        spendTransferModule: UTxO;
        mintTransferEscrowShard: UTxO;
        sendPacket: UTxO;
        hostStateStt: UTxO;
    };
    encodeAuthToken: (token: UnsignedSendPacketEscrowTxInput['channelToken']) => string;
    internalError?: (message: string) => Error;
};
export declare function createUnsignedSendPacketEscrowTx(dependencies: SendPacketEscrowDependencies, dto: UnsignedSendPacketEscrowTxInput): TxBuilder;
