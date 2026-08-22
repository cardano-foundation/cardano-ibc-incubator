import { type UTxO } from '@lucid-evolution/lucid';
import type { TransferEscrowShardLookup } from '@cardano-ibc/tx-builder';
import { ICS23MerkleTree } from './ics23MerkleTree';
export declare const TRANSFER_ESCROW_SHARD_LIVE_VALUE: Buffer<ArrayBuffer>;
export declare const TRANSFER_ESCROW_SHARD_RETIRED_VALUE: Buffer<ArrayBuffer>;
type TransferModuleDatum = {
    escrow_shard_registry_root: string;
    live_escrow_shard_count: bigint;
    voucher_supply: bigint;
};
type TransferEscrowDatum = {
    channel_id: string;
    denom: string;
    escrowed_amount: bigint;
};
type RegistryTree = Pick<ICS23MerkleTree, 'getRoot' | 'getSiblings' | 'set'>;
export type TransferEscrowShardHistoryOutput = UTxO & {
    shardTokenUnit: string;
    spent: boolean;
};
export type TransferEscrowShardRegistryDependencies = {
    transferModuleAddress: string;
    transferModuleIdentifier: string;
    shardPolicyId: string;
    findUtxosAt: (address: string) => Promise<UTxO[]>;
    findLatestShardHistory: (address: string, policyId: string) => Promise<TransferEscrowShardHistoryOutput[]>;
    encodeTransferEscrowDatum: (datum: TransferEscrowDatum) => Promise<string>;
    decodeTransferEscrowDatum: (encodedDatum: string) => Promise<TransferEscrowDatum>;
    encodeTransferModuleDatum: (datum: TransferModuleDatum) => Promise<string>;
    decodeTransferModuleDatum: (encodedDatum: string) => Promise<TransferModuleDatum>;
    createRegistryTree?: () => RegistryTree;
};
type TransferEscrowShardRegistrySnapshot = {
    kind: 'registry';
    transferModuleUtxo: UTxO;
    moduleDatum: TransferModuleDatum;
    shardPolicyId: string;
    tree: RegistryTree;
    canonicalShards: Map<string, {
        utxo: UTxO;
        datum: TransferEscrowDatum;
        denomToken: string;
    }>;
    channelLiveCounts: Map<string, bigint>;
    retiredShardUnits: Set<string>;
};
type TransferEscrowShardRetirementPreparation = {
    transferModuleUtxo: UTxO;
    shardUtxo: UTxO;
    shardTokenUnit: string;
    registrySiblings: string[];
    oldChannelLiveEscrowShardCount: bigint;
    channelLiveEscrowShardCountSiblings: string[];
    encodedUpdatedTransferModuleDatum: string;
    encodedShardDatum: string;
};
export declare function transferEscrowShardTokenName(channelId: string, packetDenom: string): string;
export declare function transferEscrowShardRegistryKey(tokenName: string): string;
export declare function transferEscrowShardChannelLiveCountKey(channelId: string): string;
export declare function transferEscrowShardCountValue(count: bigint): Buffer;
export declare function findTransferEscrowShard(dependencies: TransferEscrowShardRegistryDependencies, channelId: string, packetDenom: string, denomToken: string, principalDelta?: bigint): Promise<TransferEscrowShardLookup>;
export declare function findTransferEscrowShard(dependencies: TransferEscrowShardRegistryDependencies, channelId: string, packetDenom: string, denomToken: string, principalDelta: bigint | undefined, inspectionOnly: true): Promise<TransferEscrowShardRegistrySnapshot>;
export declare function proveTransferChannelHasNoLiveShards(dependencies: TransferEscrowShardRegistryDependencies, channelId: string): Promise<{
    transferModuleUtxo: UTxO;
    channelLiveEscrowShardCountSiblings: string[];
}>;
export declare function prepareTransferEscrowShardRetirement(dependencies: TransferEscrowShardRegistryDependencies, channelId: string, packetDenom: string): Promise<TransferEscrowShardRetirementPreparation>;
export {};
