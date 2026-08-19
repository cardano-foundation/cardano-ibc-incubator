import { type IbcStateTreeRecoveryStore } from './ibcStateRoot';
export { AsyncMutex } from './asyncMutex';
export { createTreeCheckpoint, createFetchIbcTreeRecoveryStore, installVerifiedTreeRecovery, recoverTreeFromCheckpointAndJournal, } from './ibcStateRoot';
export type { IbcStateTreeCheckpoint, IbcStateTreeJournalEntry, IbcStateTreeMutation, IbcStateTreeRecoveryState, IbcStateTreeRecoveryStore, } from './ibcStateRoot';
export declare const OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS = 10000;
export declare const OGMIOS_WEBSOCKET_REQUEST_TIMEOUT_MS = 10000;
type TransferApiRequestBody = {
    source_port?: string;
    source_channel?: string;
    token?: {
        denom?: string;
        amount?: string;
    };
    sender?: string;
    receiver?: string;
    timeout_height?: {
        revision_number?: string;
        revision_height?: string;
    };
    timeout_timestamp?: string;
    memo?: string;
    signer?: string;
    wallet_utxos?: WalletUtxoInput[];
};
type WalletUtxoInput = {
    txHash?: string;
    outputIndex?: number;
    address?: string;
    assets?: Record<string, string | number | bigint>;
    datumHash?: string | null;
    datum?: string | null;
    scriptRef?: unknown;
};
type LocalUnsignedTransferResponse = {
    result: number;
    unsignedTx: {
        type_url: string;
        unsignedTxCborHex: string;
    };
    feeLovelace: string;
};
type SubmitSignedTransactionApiRequestBody = {
    signed_tx_cbor?: unknown;
    description?: unknown;
};
type LocalSubmitSignedTransactionResponse = {
    txHash: string;
};
type RuntimeLogger = {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
type KupmiosAuthHeaders = {
    kupoHeader?: Record<string, string>;
    ogmiosHeader?: Record<string, string>;
};
export declare function withKupoStringQuantityHeader(headers?: KupmiosAuthHeaders): KupmiosAuthHeaders;
type BuilderRuntimeConfig = {
    bridgeManifestUrl: string;
    kupmiosUrl: string;
    kupmiosHeaders?: KupmiosAuthHeaders;
    fetchImpl?: typeof fetch;
    logger?: RuntimeLogger;
    ibcTreeRecoveryStore?: IbcStateTreeRecoveryStore;
    ibcTreeRecoveryUrl?: string;
    ibcSubmitUrl?: string;
};
export declare function ogmiosRequest<T>(ogmiosUrl: string, methodName: string, args: unknown, headers?: Record<string, string>, timeoutMs?: number): Promise<T>;
export declare function mapOgmiosProtocolParameters(result: any): any;
export declare function queryProtocolParametersCompat(ogmiosEndpoint: string, headers?: Record<string, string>, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<any>;
export declare function retryWithBackoff<T>(operation: () => Promise<T>, wait?: (durationMs: number) => Promise<void>): Promise<T>;
export declare function createTxBuilderRuntime(config: BuilderRuntimeConfig): {
    buildUnsignedTransfer: (body: TransferApiRequestBody) => Promise<LocalUnsignedTransferResponse>;
    submitSignedTransaction: (body: SubmitSignedTransactionApiRequestBody) => Promise<LocalSubmitSignedTransactionResponse>;
};
export type { BuilderRuntimeConfig, KupmiosAuthHeaders, LocalSubmitSignedTransactionResponse, LocalUnsignedTransferResponse, SubmitSignedTransactionApiRequestBody, TransferApiRequestBody, };
