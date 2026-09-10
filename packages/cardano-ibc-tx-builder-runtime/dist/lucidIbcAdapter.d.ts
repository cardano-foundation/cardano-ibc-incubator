import { type LucidEvolution, type TxBuilder, type UTxO } from '@lucid-evolution/lucid';
import type { UnsignedSendPacketEscrowTxInput } from '@cardano-ibc/tx-builder';
import type { IbcTreeLucidService, IbcTreeUtxo } from './ibcStateRoot';
type RefUtxo = {
    txHash: string;
    outputIndex: number;
};
type AuthToken = {
    policyId: string;
    name: string;
};
type DeploymentConfig = {
    hostStateNFT: AuthToken;
    validators: {
        hostStateStt: {
            address?: string;
            refUtxo: RefUtxo;
        };
        spendChannel: {
            address?: string;
            refUtxo: RefUtxo;
            refValidator: {
                send_packet: {
                    refUtxo: RefUtxo;
                };
            };
        };
        spendTransferModule: {
            refUtxo: RefUtxo;
        };
        mintVoucher: {
            refUtxo: RefUtxo;
            scriptHash: string;
        };
        mintPort: {
            refUtxo: RefUtxo;
            scriptHash: string;
        };
        mintTransferEscrowShard: {
            refUtxo: RefUtxo;
            scriptHash: string;
        };
        mintConnectionStt: {
            scriptHash: string;
        };
        mintChannelStt: {
            scriptHash: string;
        };
        mintClientStt: {
            scriptHash: string;
        };
    };
    modules: {
        transfer: {
            address: string;
        };
    };
};
export type CodecType = 'client' | 'consensus_state' | 'connection' | 'channel' | 'transferEscrow' | 'transferModule' | 'host_state' | 'host_state_redeemer' | 'spendChannelRedeemer' | 'iBCModuleRedeemer' | 'transferIBCModuleRedeemer' | 'mintVoucherRedeemer' | 'mintPortRedeemer' | 'transferEscrowShardRedeemer';
export declare class UtxosAtAddressNotFoundError extends Error {
    readonly addressOrCredential: string;
    constructor(addressOrCredential: string);
}
export declare class LucidIbcAdapter {
    private readonly lucid;
    private readonly deployment;
    private readonly readConsensusHistory?;
    readonly LucidImporter: typeof import('@lucid-evolution/lucid');
    private referenceScripts;
    private walletSelectionScopeCounter;
    private activeWalletSelectionScopeId;
    private explicitWalletSelectionForScopeId;
    private explicitWalletSelectionAddress;
    constructor(LucidImporter: typeof import('@lucid-evolution/lucid'), lucid: LucidEvolution, deployment: DeploymentConfig, readConsensusHistory?: IbcTreeLucidService['consensusHistoryRecords']);
    consensusHistoryRecords(client: IbcTreeUtxo): Promise<{
        datum: {
            clientToken: {
                policyId: string;
                name: string;
            };
            height: {
                revisionNumber: bigint;
                revisionHeight: bigint;
            };
            consensusState: unknown;
            processedTime: bigint;
            processedHeight: bigint;
        };
        consensusValue: string;
        archived: boolean;
    }[]>;
    onModuleInit(): Promise<void>;
    private loadReferenceScripts;
    private resolveReferenceScriptUtxo;
    private normalizeAddressOrCredential;
    selectWalletFromAddress(addressOrCredential: string, utxos: UTxO[]): void;
    beginWalletSelectionScope(): number;
    assertWalletSelectionScopeSatisfied(scopeId: number, operationName: string): void;
    endWalletSelectionScope(scopeId: number): void;
    findUtxoAt(addressOrCredential: string): Promise<UTxO[]>;
    findUtxoAtWithUnit(addressOrCredential: string, unit: string): Promise<UTxO>;
    findUtxoByUnit(unit: string): Promise<UTxO>;
    private filterLiveUtxos;
    tryFindUtxosAt(addressOrCredential: string, opts?: {
        maxAttempts?: number;
        retryDelayMs?: number;
    }): Promise<UTxO[]>;
    findUtxoAtHostStateNFT(): Promise<UTxO>;
    credentialToAddress(address: string): string;
    decodeDatum<T>(encodedDatum: string, type: CodecType): Promise<T>;
    encode<T>(data: T, type: CodecType): Promise<string>;
    getClientTokenUnit(clientId: string): string;
    getConnectionTokenUnit(connectionId: bigint): [string, string];
    getChannelTokenUnit(channelId: bigint): [string, string];
    createUnsignedSendPacketEscrowTx(dto: UnsignedSendPacketEscrowTxInput): TxBuilder;
    createUnsignedSendPacketBurnTx(dto: any): TxBuilder;
    private generateTokenName;
}
export declare function findUtxosAtAllowEmpty(lucidService: Pick<LucidIbcAdapter, 'findUtxoAt'>, addressOrCredential: string): Promise<UTxO[]>;
export type { AuthToken, DeploymentConfig };
