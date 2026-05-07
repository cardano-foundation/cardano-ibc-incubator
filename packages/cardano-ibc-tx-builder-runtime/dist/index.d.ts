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
type BuilderRuntimeConfig = {
    bridgeManifestUrl: string;
    kupmiosUrl: string;
    kupmiosHeaders?: KupmiosAuthHeaders;
    fetchImpl?: typeof fetch;
    logger?: RuntimeLogger;
};
export declare function createTxBuilderRuntime(config: BuilderRuntimeConfig): {
    buildUnsignedTransfer: (body: TransferApiRequestBody) => Promise<LocalUnsignedTransferResponse>;
    submitSignedTransaction: (body: SubmitSignedTransactionApiRequestBody) => Promise<LocalSubmitSignedTransactionResponse>;
};
export type { BuilderRuntimeConfig, LocalSubmitSignedTransactionResponse, LocalUnsignedTransferResponse, SubmitSignedTransactionApiRequestBody, TransferApiRequestBody, };
