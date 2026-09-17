import { type LucidEvolution, type TxBuilder, type UTxO } from '@lucid-evolution/lucid';
export declare class BridgeMigrationInProgressError extends Error {
    constructor();
}
export type MigrationRuntimeConfig = {
    profile: 'cardano-ibc-compatible-v1';
    registryUnit: string;
    registryAddress: string;
    generation: string;
    compatibility: string;
    originalAddresses: string[];
};
export type MigrationRuntimeDeployment = {
    migration?: MigrationRuntimeConfig;
    hostStateNFT: {
        policyId: string;
        name: string;
    };
    validators: Record<'hostStateStt' | 'spendClient' | 'spendConnection' | 'spendChannel' | 'spendTransferModule', {
        address?: string;
    }> & Record<'mintClientStt' | 'mintConnectionStt' | 'mintChannelStt' | 'mintTransferEscrowShard', {
        scriptHash: string;
    }>;
    modules: {
        transfer: {
            address: string;
        };
    };
};
export declare function requireMigrationConfig(value: unknown): MigrationRuntimeConfig;
/** Read the canonical NFT and compare all role addresses, including stake parts.
 * The returned out-ref is included in the transaction: a concurrent handover
 * invalidates it at the ledger even if an indexer has temporarily served stale data.
 */
export declare function migrationReference(lucid: LucidEvolution, deployment: MigrationRuntimeDeployment, createObject?: boolean): Promise<UTxO | undefined>;
/** Attach authorization as an ordinary builder action before returning it.
 * All completion APIs and composition therefore preserve the reference input.
 * A rejected transaction must be rebuilt from fresh canonical state.
 */
export declare function withMigrationReference(lucid: LucidEvolution, tx: TxBuilder, deployment: MigrationRuntimeDeployment, createObject?: boolean): Promise<TxBuilder>;
