import { ICS23MerkleTree } from './ics23MerkleTree';
type ChannelStateLike = {
    channel: any;
    next_sequence_send: bigint;
    next_sequence_recv: bigint;
    next_sequence_ack: bigint;
    packet_commitment: Map<bigint, string>;
    packet_receipt: Map<bigint, string>;
    packet_acknowledgement: Map<bigint, string>;
};
type ChannelDatumLike = {
    state: ChannelStateLike;
    port: string;
};
type StateRootResult = {
    newRoot: string;
    commit: () => void;
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
export declare function computeRootWithHandlePacketUpdate(oldRoot: string, portId: string, channelId: string, inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, Lucid: typeof import('@lucid-evolution/lucid')): Promise<HandlePacketStateRootResult>;
export declare function rebuildTreeFromChain(kupoService: any, lucidService: any): Promise<{
    tree: ICS23MerkleTree;
    root: string;
}>;
export {};
