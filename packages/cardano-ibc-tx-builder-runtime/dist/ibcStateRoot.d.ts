import { ICS23MerkleTree } from './ics23MerkleTree';
type ChannelStateLike = {
    channel: any;
    next_sequence_send: bigint;
    next_sequence_recv: bigint;
    next_sequence_ack: bigint;
};
type ChannelDatumLike = {
    state: ChannelStateLike;
    port: string;
};
type StateRootResult = {
    newRoot: string;
    commit: () => void;
    journalEntry: IbcStateTreeJournalEntry;
};
type HandlePacketStateRootResult = StateRootResult & {
    channelSiblings: string[];
    nextSequenceSendSiblings: string[];
    nextSequenceRecvSiblings: string[];
    nextSequenceAckSiblings: string[];
    packetCommitmentSiblings: string[];
    packetReceiptSiblings: string[];
    packetAcknowledgementSiblings: string[];
};
export type PacketStateOperation = {
    kind: 'send';
    sequence: bigint;
    commitment: string;
} | {
    kind: 'recv';
    sequence: bigint;
    acknowledgementCommitment: string;
} | {
    kind: 'acknowledge';
    sequence: bigint;
    commitment: string;
} | {
    kind: 'timeout';
    sequence: bigint;
    commitment: string;
};
export type IbcStateTreeMutation = {
    key: string;
    oldValue: string | null;
    newValue: string | null;
};
export type IbcStateTreeJournalEntry = {
    previousRoot: string;
    newRoot: string;
    mutations: IbcStateTreeMutation[];
};
export type IbcStateTreeCheckpoint = {
    formatVersion: 1;
    root: string;
    leaves: Record<string, string>;
};
export type IbcStateTreeRecoveryState = {
    checkpoint: IbcStateTreeCheckpoint;
    journal: IbcStateTreeJournalEntry[];
};
export type IbcStateTreeRecoveryStore = {
    load(expectedRoot: string): Promise<IbcStateTreeRecoveryState | null>;
    prepare?(txBodyHash: string, transition: IbcStateTreeJournalEntry): Promise<void>;
};
export declare function createFetchIbcTreeRecoveryStore(endpoint: string, fetchImpl?: typeof fetch): IbcStateTreeRecoveryStore;
export declare function initTreeServices(kupoService: any, lucidService: any, recoveryStore?: IbcStateTreeRecoveryStore): void;
export declare function isTreeAligned(onChainRoot: string): boolean;
export declare function alignTreeWithChain(): Promise<{
    root: string;
}>;
export declare function computeRootWithHandlePacketUpdate(oldRoot: string, portId: string, channelId: string, inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, operation: PacketStateOperation, Lucid: typeof import('@lucid-evolution/lucid')): Promise<HandlePacketStateRootResult>;
export declare function createTreeCheckpoint(tree?: ICS23MerkleTree): IbcStateTreeCheckpoint;
export declare function recoverTreeFromCheckpointAndJournal(recovery: IbcStateTreeRecoveryState, expectedRoot: string): ICS23MerkleTree;
export declare function installVerifiedTreeRecovery(recovery: IbcStateTreeRecoveryState, expectedRoot: string): {
    tree: ICS23MerkleTree;
    root: string;
};
export declare function resetTreeState(): void;
export declare function rebuildTreeFromChain(kupoService: any, lucidService: any, recoveryStore?: IbcStateTreeRecoveryStore): Promise<{
    tree: ICS23MerkleTree;
    root: string;
}>;
export {};
