import { Constr, Data, type LucidEvolution, type UTxO } from "@lucid-evolution/lucid";
import { ICS23MerkleTree } from "./ics23MerkleTree.ts";
declare class PacketLaneTree {
    readonly tree: ICS23MerkleTree;
    set(key: string, value: string): void;
    getRoot(): string;
    getSiblings(key: string): string[];
}
export declare const record: (...fields: Data[]) => Constr<Data>;
export declare const variant: (index: number, ...fields: Data[]) => Constr<Data>;
export declare const encode: (data: Data) => string;
export declare const outRef: (utxo: UTxO) => Constr<Data>;
export declare const sha256: (hex: string) => Promise<string>;
export interface PacketLaneDeployment {
    operations: Record<string, {
        policy: string;
        reference: UTxO;
    }>;
    proofVerifier: {
        policy: string;
        reference: UTxO;
    };
    batchPolicy: string;
    batchAddress: string;
    guardAddress: string;
    statePolicy: string;
    laneCount: number;
    voucherPolicy?: string;
    historyWitness?: Data;
    channel: UTxO;
    connection: UTxO;
    client: UTxO;
    scripts: UTxO[];
}
export declare const MAX_LANE_BALANCES = 8;
/** Cancel completed cross-lane obligations, or redistribute keys to admit a return.
 * Only these two lanes are spent. Packet roots, replay state and reserves are preserved.
 * leftDenoms can place a returning asset in its receive lane even when both maps are full.
 */
export declare function buildPacketBalanceCompaction(lucid: LucidEvolution, deployment: PacketLaneDeployment, leftLane: number, rightLane: number, leftDenoms?: string[]): Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    inputs: (import("@lucid-evolution/core-types").OutRef & import("@lucid-evolution/core-types").TxOutput)[];
    datums: Constr<Data>[];
}>;
export interface FundedTransfer {
    amount: bigint;
    receiver: string;
    timeoutTimestamp: bigint;
    assetUnit?: string;
    reserve?: bigint;
    memo?: string;
    fullDenom?: string;
}
/** Admission spends only the user's funding. It has no protocol state inputs. */
export declare function buildTransferIntent(lucid: LucidEvolution, deployment: Pick<PacketLaneDeployment, "channel" | "guardAddress">, request: FundedTransfer): Promise<import("@lucid-evolution/lucid").TxBuilder>;
export declare function laneTree(datum: Constr<Data>): Promise<PacketLaneTree>;
/** Read current included outputs on every build. Preparing a transaction never
 * publishes speculative roots or sequences, so retries after rollback reload
 * the ledger's state instead of advancing a process-local counter. */
export declare function buildPacketSendBatch(lucid: LucidEvolution, deployment: PacketLaneDeployment, intents: UTxO[], validFrom: number, validTo: number): Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    packets: Constr<Data>[];
    operation: Constr<Data>;
    inputs: UTxO[];
    escrows: {
        datum: Constr<Data>;
        assets: Record<string, bigint>;
    }[];
}>;
export declare const buildPacketAcknowledgement: (lucid: LucidEvolution, deployment: PacketLaneDeployment, packet: Constr<Data>, proofHeight: Constr<Data>, proof: Constr<Data>, validFrom: number, validTo: number) => Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
/** Full-drain timeout refunds. Partial releases require a separate selection strategy. */
export declare const buildPacketTimeout: (lucid: LucidEvolution, deployment: PacketLaneDeployment, packet: Constr<Data>, proofHeight: Constr<Data>, proof: Constr<Data>, liquidity: UTxO[], validFrom: number, validTo: number) => Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
/** Retire empty outputs, or consolidate into the first identity without releasing principal. */
export declare function buildLiquidityRetirement(lucid: LucidEvolution, deployment: PacketLaneDeployment, inputs: UTxO[], consolidate?: boolean): Promise<import("@lucid-evolution/lucid").TxBuilder>;
export declare function buildTransferIntentCancellation(lucid: LucidEvolution, deployment: PacketLaneDeployment, intent: UTxO): Promise<import("@lucid-evolution/lucid").TxBuilder>;
export declare function buildPacketLaneInitialization(lucid: LucidEvolution, deployment: PacketLaneDeployment, config: UTxO, registryAddress: string): Promise<import("@lucid-evolution/lucid").TxBuilder>;
export declare function buildPacketReceive(lucid: LucidEvolution, deployment: PacketLaneDeployment, packet: Constr<Data>, proofHeight: Constr<Data>, proof: Constr<Data>, liquidity: UTxO[], validFrom: number, validTo: number): Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
export declare const buildPacketRejection: (lucid: LucidEvolution, deployment: PacketLaneDeployment, packet: Constr<Data>, proofHeight: Constr<Data>, proof: Constr<Data>, liquidity: UTxO[], rejection: string, validFrom: number, validTo: number) => Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
export declare function voucherTokenName(denom: string): string;
export declare function localAssetUnit(denom: string, deployment: Pick<PacketLaneDeployment, "voucherPolicy">): string;
export declare function buildPacketPrune(lucid: LucidEvolution, deployment: PacketLaneDeployment, sequence: bigint, proofHeight: Constr<Data>, proof: Constr<Data>, validFrom: number, validTo: number): Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
export declare const buildPacketTimeoutOnClose: (lucid: LucidEvolution, deployment: PacketLaneDeployment, packet: Constr<Data>, proofHeight: Constr<Data>, proof: Constr<Data>, proofClose: Constr<Data>, liquidity: UTxO[], validFrom: number, validTo: number) => Promise<{
    tx: import("@lucid-evolution/lucid").TxBuilder;
    input: UTxO;
}>;
/** Admission is permissionless, so batch discovery must reject unfunded or malformed datums. */
export declare function usableTransferIntent(input: UTxO, deployment: PacketLaneDeployment, validTo: number): boolean;
/** Script addresses accept arbitrary deposits. Authenticate before selecting funds. */
export declare function selectPacketLiquidity(inputs: UTxO[], deployment: PacketLaneDeployment, port: string, channel: string, denom: string, amount: bigint, sequence: bigint): UTxO[];
export {};
