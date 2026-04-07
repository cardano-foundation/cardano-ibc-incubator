import { type LucidEvolution, type TxBuilder, type UTxO } from '@lucid-evolution/lucid';
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
export type CodecType = 'client' | 'connection' | 'channel' | 'host_state' | 'host_state_redeemer' | 'spendChannelRedeemer' | 'iBCModuleRedeemer' | 'mintVoucherRedeemer';
export declare class LucidIbcAdapter {
    private readonly lucid;
    private readonly deployment;
    readonly LucidImporter: typeof import('@lucid-evolution/lucid');
    private referenceScripts;
    private walletSelectionScopeCounter;
    private activeWalletSelectionScopeId;
    private explicitWalletSelectionForScopeId;
    private explicitWalletSelectionAddress;
    constructor(LucidImporter: typeof import('@lucid-evolution/lucid'), lucid: LucidEvolution, deployment: DeploymentConfig);
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
    createUnsignedSendPacketEscrowTx(dto: any): TxBuilder;
    createUnsignedSendPacketBurnTx(dto: any): TxBuilder;
    private generateTokenName;
}
export type { AuthToken, DeploymentConfig };
