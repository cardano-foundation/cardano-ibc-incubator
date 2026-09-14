import type { UTxO } from '@lucid-evolution/lucid';
import type { TransferEscrowShardLookup as BuilderTransferEscrowShardLookup } from '@cardano-ibc/tx-builder';
import { ICS23MerkleTree } from './ics23MerkleTree';
export declare const TRANSFER_ESCROW_SHARD_REGISTERED_VALUE: Buffer<ArrayBuffer>;
type TransferModuleDatum = {
    escrow_shard_registry_root: string;
};
type TransferEscrowDatum = {
    channel_id: string;
    denom: string;
    escrowed_amount: bigint;
};
type RegistryTree = Pick<ICS23MerkleTree, 'getRoot' | 'getSiblings' | 'set'>;
type ErrorFactory = (message: string) => Error;
export type TransferEscrowShardLookup = BuilderTransferEscrowShardLookup & {
    registrySiblings: string[];
};
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
    invalidArgument?: ErrorFactory;
    failedPrecondition?: ErrorFactory;
};
export declare function transferEscrowShardTokenName(channelId: string, packetDenom: string): string;
export declare function transferEscrowShardRegistryKey(tokenName: string): string;
export declare function escrowDenomTokenFromPacketDenom(encodedDenom: string): string;
export declare function getTransferModuleRootFromAddressScan(utxos: UTxO[], transferModuleIdentifier: string, failedPrecondition?: ErrorFactory): UTxO;
export declare function findTransferEscrowShard(dependencies: TransferEscrowShardRegistryDependencies, channelId: string, packetDenom: string, denomToken: string, requiredAmount?: bigint, balanceDelta?: bigint): Promise<TransferEscrowShardLookup>;
export {};
