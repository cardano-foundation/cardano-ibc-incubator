import { ICS23MerkleTree } from './ics23MerkleTree';
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
export type StateRootResult = {
    newRoot: string;
    commit: () => void;
};
export type HandlePacketStateRootResult = StateRootResult & {
    channelSiblings: string[];
    nextSequenceSendSiblings: string[];
    nextSequenceRecvSiblings: string[];
    nextSequenceAckSiblings: string[];
    packetCommitmentSiblings: string[];
    packetReceiptSiblings: string[];
    packetAcknowledgementSiblings: string[];
};
export interface CreateClientStateRootResult extends StateRootResult {
    clientStateSiblings: string[];
    consensusStateSiblings: string[];
}
export interface CreateConnectionStateRootResult extends StateRootResult {
    connectionSiblings: string[];
}
export interface CreateChannelStateRootResult extends StateRootResult {
    channelSiblings: string[];
    nextSequenceSendSiblings: string[];
    nextSequenceRecvSiblings: string[];
    nextSequenceAckSiblings: string[];
}
export interface BindPortStateRootResult extends StateRootResult {
    portSiblings: string[];
}
export interface UpdateChannelStateRootResult extends StateRootResult {
    channelSiblings: string[];
}
export interface UpdateClientStateRootResult extends StateRootResult {
    clientStateSiblings: string[];
    consensusStateSiblings: string[];
    removedConsensusStateSiblings: string[][];
}
export interface PrunePacketHistoryStateRootResult extends StateRootResult {
    packetReceiptSiblings: string[];
    packetAcknowledgementSiblings: string[];
}
export declare function initTreeServices(kupoService: any, lucidService: any): void;
export declare function isTreeAligned(onChainRoot: string): boolean;
export declare function alignTreeWithChain(): Promise<{
    root: string;
}>;
export declare function encodeClientStateValue(clientState: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeConsensusStateValue(consensusState: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeConnectionEndValue(connectionEnd: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeChannelEndValue(channelEnd: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function computeRootWithHandlePacketUpdate(oldRoot: string, portId: string, channelId: string, inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, Lucid: typeof import('@lucid-evolution/lucid')): Promise<HandlePacketStateRootResult>;
export declare function rebuildTreeFromChain(kupoService: any, lucidService: any): Promise<{
    tree: ICS23MerkleTree;
    root: string;
}>;
export declare function computeRootWithCreateClientUpdate(oldRoot: string, clientId: string, clientStateValue: Buffer, consensusStateValue: Buffer, consensusHeight: string | number | bigint): CreateClientStateRootResult;
export declare function computeRootWithUpdateClientUpdate(oldRoot: string, clientId: string, newClientStateValue: Buffer, removedConsensusHeights: Array<string | number | bigint>, addedConsensusState: {
    height: string | number | bigint;
    value: Buffer;
} | undefined): UpdateClientStateRootResult;
export declare function computeRootWithCreateConnectionUpdate(oldRoot: string, connectionId: string, connectionValue: Buffer): CreateConnectionStateRootResult;
export declare function computeRootWithCreateChannelUpdate(oldRoot: string, portId: string, channelId: string, channelValue: Buffer, nextSequenceSendValue: Buffer, nextSequenceRecvValue: Buffer, nextSequenceAckValue: Buffer): CreateChannelStateRootResult;
export declare function computeRootWithUpdateChannelUpdate(oldRoot: string, portId: string, channelId: string, channelValue: Buffer): UpdateChannelStateRootResult;
export declare function computeRootWithPrunePacketHistoryUpdate(oldRoot: string, portId: string, channelId: string, sequence: bigint, ordering: 'None' | 'Unordered' | 'Ordered'): PrunePacketHistoryStateRootResult;
export declare function computeRootWithPortBind(oldRoot: string, portId: string, portValue: Buffer): BindPortStateRootResult;
export declare function getCurrentTree(): ICS23MerkleTree;
export declare function setCurrentTree(tree: ICS23MerkleTree): void;
export declare function getCurrentRoot(): string;
export declare function resetTreeState(): void;
export declare function encodeModuleRegistration(registration: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export {};
