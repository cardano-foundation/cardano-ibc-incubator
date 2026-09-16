import { Constr, Data } from "@lucid-evolution/lucid";
export declare const EMPTY_CONSENSUS_HISTORY_ROOT: string;
export declare const CONSENSUS_HISTORY_KEY_PREFIX = "internal/consensus-history/v1/";
export interface ConsensusHistoryClientToken {
    readonly policyId: string;
    readonly name: string;
}
export interface ConsensusHistoryHeight {
    readonly revisionNumber: bigint;
    readonly revisionHeight: bigint;
}
export interface ConsensusHistoryRecord {
    readonly clientToken: ConsensusHistoryClientToken;
    readonly height: ConsensusHistoryHeight;
    readonly consensusState: {
        readonly timestamp: bigint;
        readonly nextValidatorsHash: string;
        readonly root: string;
    };
    readonly processedTime: bigint;
    readonly processedHeight: bigint;
}
export interface ConsensusHistoryWitness {
    readonly root: string;
    readonly key: string;
    readonly value: string;
    readonly record: ConsensusHistoryRecord;
    readonly siblings: string[];
}
export interface ConsensusHistorySnapshot {
    readonly version: 1;
    readonly root: string;
    readonly records: string[];
}
export declare function recordToConstr(record: ConsensusHistoryRecord): Constr<Data>;
export declare function recordFromConstr(value: Data): ConsensusHistoryRecord;
export declare function encodeConsensusHistoryRecord(record: ConsensusHistoryRecord): string;
export declare function decodeConsensusHistoryRecord(cbor: string): ConsensusHistoryRecord;
export declare function consensusHistoryKey(clientToken: ConsensusHistoryClientToken, height: ConsensusHistoryHeight): string;
export declare class ConsensusHistoryCommitment {
    #private;
    get size(): number;
    append(record: ConsensusHistoryRecord): void;
    get(token: ConsensusHistoryClientToken, height: ConsensusHistoryHeight): ConsensusHistoryRecord | undefined;
    getRoot(): Promise<string>;
    witness(token: ConsensusHistoryClientToken, height: ConsensusHistoryHeight): Promise<ConsensusHistoryWitness>;
    insertionWitness(record: ConsensusHistoryRecord): Promise<ConsensusHistoryWitness>;
    snapshot(): Promise<ConsensusHistorySnapshot>;
    static replay(records: Iterable<ConsensusHistoryRecord>, expectedRoot: string): Promise<ConsensusHistoryCommitment>;
    static fromSnapshot(snapshot: unknown, expectedRoot: string): Promise<ConsensusHistoryCommitment>;
    private currentView;
    private makeWitness;
}
