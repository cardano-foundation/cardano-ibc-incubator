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
type RuntimeLogger = {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
type BuilderRuntimeConfig = {
    bridgeManifestUrl: string;
    kupmiosUrl: string;
    fetchImpl?: typeof fetch;
    logger?: RuntimeLogger;
};
export declare function createTxBuilderRuntime(config: BuilderRuntimeConfig): {
    buildUnsignedTransfer: (body: TransferApiRequestBody) => Promise<LocalUnsignedTransferResponse>;
};
export type { BuilderRuntimeConfig, LocalUnsignedTransferResponse, TransferApiRequestBody, };
