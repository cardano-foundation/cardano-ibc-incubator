import { type UTxO } from "@lucid-evolution/lucid";
import { type ConsensusHistoryClientToken, type ConsensusHistoryHeight, type ConsensusHistoryRecord, type ConsensusHistoryWitness } from "./consensusHistory.ts";
export interface HistoryDeployment {
    readonly layout?: "production" | "prototype";
    readonly clientToken: ConsensusHistoryClientToken;
    readonly stateAddress: string;
    readonly bootstrap: {
        readonly txHash: string;
        readonly outputIndex: number;
    };
}
export interface HistoryPoint {
    readonly txHash: string;
    readonly blockHash: string;
    readonly blockHeight: number;
    readonly slot: number;
    readonly transactionIndex: number;
}
export interface HistoryTransaction extends HistoryPoint {
    readonly cbor: string;
    readonly valid?: boolean;
}
/** The saved point is no longer on the source's canonical chain. */
export declare class HistoryIntersectionError extends Error {
}
/** A pinned source snapshot rolled back while it was being consumed. */
export declare class HistorySnapshotChangedError extends Error {
}
export interface HistorySource {
    transactions(after?: HistoryPoint): AsyncIterable<HistoryTransaction>;
    currentState(): Promise<UTxO>;
}
interface State {
    root: string;
    clientValue: string;
    consensusValue: string;
    record: ConsensusHistoryRecord;
}
export interface ConsensusHistoryCurrent extends State {
    readonly utxo: UTxO;
    readonly point: HistoryPoint;
}
export interface ConsensusHistoryEntry {
    readonly record: ConsensusHistoryRecord;
    readonly consensusValue: string;
    readonly archived: boolean;
}
/** Hash-check source evidence before accepting a discovered genesis output. */
export declare function validateHistoryBootstrap(evidence: HistoryTransaction, clientToken: ConsensusHistoryClientToken, outputIndex: number, stateAddress?: string): void;
/** A disposable, single-deployment history index with atomic fork recovery. */
export declare class ConsensusHistoryRecovery {
    #private;
    constructor(path: string, deployment: HistoryDeployment);
    recover(source: HistorySource, options?: {
        maxPasses?: number;
    }): Promise<{
        root: string;
        transactions: number;
        milliseconds: number;
    }>;
    witness(token: ConsensusHistoryClientToken, height: ConsensusHistoryHeight): ConsensusHistoryWitness;
    /** Last independently anchored client output; callers bind plans to its ref. */
    current(): ConsensusHistoryCurrent;
    /** Empty-leaf proof and candidate root for archiving the current tip. */
    insertionWitness(): ConsensusHistoryWitness & {
        newRoot: string;
    };
    /** Stream authenticated records, including the live tip, without snapshots. */
    records(): AsyncGenerator<ConsensusHistoryEntry>;
    /** Numeric height ordering follows the validated increasing client lineage. */
    heights(options?: {
        after?: ConsensusHistoryHeight;
        limit?: number;
    }): Promise<ConsensusHistoryHeight[]>;
    close(): void;
    private open;
    private recordRow;
    private readReady;
    private row;
    private tip;
    private point;
    private atomic;
    private checkCache;
    private checkOutput;
    private matchAnchor;
    private spends;
    private consensusKey;
    private apply;
    private rewind;
}
export {};
