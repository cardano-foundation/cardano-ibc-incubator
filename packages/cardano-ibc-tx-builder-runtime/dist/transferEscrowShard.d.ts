import type { UTxO } from '@lucid-evolution/lucid';
import type { TransferEscrowShardLookup } from '@cardano-ibc/tx-builder';
import { ICS23MerkleTree } from './ics23MerkleTree';
type TransferModuleDatum = {
    escrow_shard_registry_root: string;
};
type TransferEscrowDatum = {
    channel_id: string;
    denom: string;
};
type RegistryTree = Pick<ICS23MerkleTree, 'getRoot' | 'getSiblings' | 'set'>;
export type TransferEscrowShardRegistryDependencies = {
    transferModuleAddress: string;
    transferModuleIdentifier: string;
    shardPolicyId: string;
    findUtxosAt: (address: string) => Promise<UTxO[]>;
    encodeTransferEscrowDatum: (datum: TransferEscrowDatum) => Promise<string>;
    decodeTransferEscrowDatum: (encodedDatum: string) => Promise<TransferEscrowDatum>;
    encodeTransferModuleDatum: (datum: TransferModuleDatum) => Promise<string>;
    decodeTransferModuleDatum: (encodedDatum: string) => Promise<TransferModuleDatum>;
    createRegistryTree?: () => RegistryTree;
};
export declare function transferEscrowShardTokenName(channelId: string, packetDenom: string): string;
export declare function transferEscrowShardRegistryKey(tokenName: string): string;
export declare function findTransferEscrowShard(dependencies: TransferEscrowShardRegistryDependencies, channelId: string, packetDenom: string, denomToken: string, requiredAmount?: bigint): Promise<TransferEscrowShardLookup>;
export {};
