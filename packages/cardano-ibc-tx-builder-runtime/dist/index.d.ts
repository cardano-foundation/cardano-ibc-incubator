export { AsyncMutex } from './asyncMutex';
export { TRANSFER_ESCROW_SHARD_LIVE_VALUE, TRANSFER_ESCROW_SHARD_RETIRED_VALUE, prepareTransferEscrowShardRetirement, proveTransferChannelHasNoLiveShards, transferEscrowShardChannelLiveCountKey, transferEscrowShardCountValue, transferEscrowShardTokenName, } from './transferEscrowShard';
export { computeRootWithOrderedUpdates, type OrderedStateRootResult, type OrderedStateRootUpdate, } from './ibcStateRoot';
export declare const OGMIOS_PROTOCOL_PARAMETERS_REQUEST_TIMEOUT_MS = 10000;
export declare const OGMIOS_WEBSOCKET_REQUEST_TIMEOUT_MS = 10000;
type RefUtxo = {
    txHash: string;
    outputIndex: number;
    scriptHash?: string;
};
export declare function computeReferenceScriptInventoryRoot(references: RefUtxo[]): string;
type AuthToken = {
    policyId: string;
    name: string;
};
type DeploymentRefValidator = {
    scriptHash: string;
    refUtxo: RefUtxo;
};
type DeploymentValidator = {
    scriptHash: string;
    address?: string;
    refUtxo: RefUtxo;
};
type DeploymentSpendChannelValidator = DeploymentValidator & {
    refValidator: {
        acknowledge_packet: DeploymentRefValidator;
        chan_close_confirm: DeploymentRefValidator;
        chan_close_init: DeploymentRefValidator;
        chan_open_ack: DeploymentRefValidator;
        chan_open_confirm: DeploymentRefValidator;
        recv_packet: DeploymentRefValidator;
        prune_packet_history: DeploymentRefValidator;
        send_packet: DeploymentRefValidator;
        timeout_packet: DeploymentRefValidator;
    };
};
type DeploymentModule = {
    identifier: string;
    address: string;
};
type DeploymentTraceRegistry = {
    address: string;
    shardPolicyId: string;
    directory: {
        policyId: string;
        name: string;
    };
};
type DeploymentReferenceValidator = {
    script: string;
    scriptHash: string;
    address: string;
};
type DeploymentConfig = {
    deployedAt: string;
    referenceOutRefs: RefUtxo[];
    referenceScriptInventoryRoot: string;
    referenceValidator: DeploymentReferenceValidator;
    hostStateNFT: AuthToken & {
        script: string;
    };
    validators: {
        hostStateStt: DeploymentValidator;
        spendClient: DeploymentValidator;
        spendConnection: DeploymentValidator;
        spendChannel: DeploymentSpendChannelValidator;
        spendMockModule?: DeploymentValidator;
        spendTraceRegistry?: DeploymentValidator;
        spendTransferModule: DeploymentValidator;
        mintIdentifier: DeploymentValidator;
        verifyProof: DeploymentValidator;
        mintClientStt: DeploymentValidator;
        mintConnectionStt: DeploymentValidator;
        mintChannelStt: DeploymentValidator;
        mintLifecycleCreationMarker: DeploymentValidator;
        mintLifecycleReclamationMarker: DeploymentValidator;
        mintLifecycleOperationalMarker: DeploymentValidator;
        mintLifecyclePacketMarker: DeploymentValidator;
        mintVoucher: DeploymentValidator;
        mintTransferEscrowShard: DeploymentValidator;
        mintPort: DeploymentValidator;
        mintTraceRegistryBenchmarkVoucher?: DeploymentValidator;
        voucherMetadata?: {
            address: string;
        };
    };
    modules: {
        transfer: DeploymentModule;
        mock?: DeploymentModule;
        icq?: DeploymentModule;
    };
    traceRegistry?: DeploymentTraceRegistry;
};
type BridgeManifest = {
    schema_version: number;
    deployed_at: string;
    cardano: {
        network: string;
    };
    host_state_nft: {
        policy_id: string;
        token_name: string;
        script: string;
    };
    reference_out_refs: Array<{
        tx_hash: string;
        output_index: number | bigint | string;
        script_hash?: string;
    }>;
    reference_script_inventory_root: string;
    reference_validator: {
        script: string;
        script_hash: string;
        address: string;
    };
    validators: {
        host_state_stt: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        spend_client: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        spend_connection: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        spend_channel: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
            ref_validator: {
                acknowledge_packet: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                chan_close_confirm: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                chan_close_init: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                chan_open_ack: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                chan_open_confirm: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                recv_packet: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                prune_packet_history: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                send_packet: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
                timeout_packet: {
                    script_hash: string;
                    ref_utxo: {
                        tx_hash: string;
                        output_index: number;
                    };
                };
            };
        };
        spend_mock_module?: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        spend_trace_registry?: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        spend_transfer_module: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_identifier: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        verify_proof: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_client_stt: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_connection_stt: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_channel_stt: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_lifecycle_creation_marker: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_lifecycle_reclamation_marker: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_lifecycle_operational_marker: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_lifecycle_packet_marker: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_voucher: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_transfer_escrow_shard: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_port: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        mint_trace_registry_benchmark_voucher?: {
            script_hash: string;
            address: string;
            ref_utxo: {
                tx_hash: string;
                output_index: number;
            };
        };
        voucher_metadata?: {
            address: string;
        };
    };
    modules: {
        transfer: {
            identifier: string;
            address: string;
        };
        mock?: {
            identifier: string;
            address: string;
        };
        icq?: {
            identifier: string;
            address: string;
        };
    };
    trace_registry?: {
        address: string;
        shard_policy_id: string;
        directory: {
            policy_id: string;
            token_name: string;
        };
    };
};
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
};
export declare function normalizeBridgeManifest(manifest: BridgeManifest): {
    deployment: DeploymentConfig;
    bridgeManifest: BridgeManifest;
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
