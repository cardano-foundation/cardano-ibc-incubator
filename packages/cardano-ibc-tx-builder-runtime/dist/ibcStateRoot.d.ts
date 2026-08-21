import { ICS23MerkleTree } from "./ics23MerkleTree";
type ChannelStateLike = {
    channel: any;
    next_sequence_send: bigint;
    next_sequence_recv: bigint;
    next_sequence_ack: bigint;
    packet_commitment: Map<bigint, string>;
    packet_receipt: Map<bigint, string>;
    packet_acknowledgement: Map<bigint, string>;
    minimum_receive_proof_height: {
        revisionNumber: bigint;
        revisionHeight: bigint;
    };
    maximum_receive_proof_height: {
        revisionNumber: bigint;
        revisionHeight: bigint;
    };
};
type ChannelDatumLike = {
    state: ChannelStateLike;
    port: string;
};
type StateRootResult = {
    newRoot: string;
    commit: () => void;
};
export type OrderedStateRootUpdate = {
    path: string;
    /** An empty value deletes the leaf. */
    newValue: Buffer | string;
};
export type OrderedStateRootResult = StateRootResult & {
    /** Siblings are captured immediately before applying the update at the same index. */
    siblings: string[][];
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
export declare function initTreeServices(kupoService: any, lucidService: any): void;
export declare function isTreeAligned(onChainRoot: string): boolean;
export declare function alignTreeWithChain(): Promise<{
    root: string;
}>;
/**
 * Apply an ordered batch of HostState commitment updates atomically. This is
 * intentionally generic so lifecycle builders can compose the exact leaf
 * deletions and dependency-count updates required by their on-chain witnesses.
 */
export declare function computeRootWithOrderedUpdates(oldRoot: string, updates: OrderedStateRootUpdate[]): OrderedStateRootResult;
export declare function computeRootWithHandlePacketUpdate(oldRoot: string, portId: string, channelId: string, inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, Lucid: typeof import("@lucid-evolution/lucid")): Promise<HandlePacketStateRootResult>;
/** Map a local retired-module key (NUL + port bytes) back to its committed ICS port. */
export declare function committedModulePortIdHex(hostPortIdHex: string): string;
export declare function rebuildTreeFromChain(kupoService: any, lucidService: any): Promise<{
    tree: ICS23MerkleTree;
    root: string;
}>;
export {};
