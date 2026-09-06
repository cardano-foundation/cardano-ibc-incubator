import type { UTxO } from '@lucid-evolution/lucid';
import { ICS23MerkleTree } from './ics23MerkleTree';
export type IbcTreeDeployment = Readonly<{
    network: string;
    hostStateNFT: Readonly<{
        policyId: string;
        name: string;
    }>;
}>;
export type IbcTreeUtxo = Pick<UTxO, 'datum' | 'assets'>;
export interface IbcTreeKupoService {
    queryAllClientUtxos(): Promise<IbcTreeUtxo[]>;
    queryAllConnectionUtxos(): Promise<IbcTreeUtxo[]>;
    queryAllChannelUtxos(): Promise<IbcTreeUtxo[]>;
}
export interface IbcTreeLucidService {
    readonly LucidImporter: typeof import('@lucid-evolution/lucid');
    findUtxoAtHostStateNFT(): Promise<IbcTreeUtxo | undefined>;
    decodeDatum<T>(encodedDatum: string, type: 'host_state' | 'client' | 'connection' | 'channel'): Promise<T>;
}
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
export declare function encodeClientStateValue(clientState: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeConsensusStateValue(consensusState: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeConnectionEndValue(connectionEnd: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeChannelEndValue(channelEnd: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
export declare function encodeModuleRegistration(registration: any, Lucid: typeof import('@lucid-evolution/lucid')): Promise<string>;
/**
 * One deployment's working tree and the readers used to rebuild it.
 * Computations use clones and only replace this store's tree when committed.
 */
export declare class IbcTreeStateStore {
    private readonly kupoService;
    private readonly lucidService;
    readonly deployment: IbcTreeDeployment;
    private currentTree;
    constructor(deployment: IbcTreeDeployment, kupoService: IbcTreeKupoService, lucidService: IbcTreeLucidService);
    isTreeAligned(onChainRoot: string): boolean;
    alignTreeWithChain(): Promise<{
        root: string;
    }>;
    private getClonedTreeFromRoot;
    computeRootWithHandlePacketUpdate(oldRoot: string, portId: string, channelId: string, inputChannelDatum: ChannelDatumLike, outputChannelDatum: ChannelDatumLike, Lucid: typeof import('@lucid-evolution/lucid')): Promise<HandlePacketStateRootResult>;
    rebuildTreeFromChain(): Promise<{
        tree: ICS23MerkleTree;
        root: string;
    }>;
    computeRootWithCreateClientUpdate(oldRoot: string, clientId: string, clientStateValue: Buffer, consensusStateValue: Buffer, consensusHeight: string | number | bigint): CreateClientStateRootResult;
    computeRootWithUpdateClientUpdate(oldRoot: string, clientId: string, newClientStateValue: Buffer, removedConsensusHeights: Array<string | number | bigint>, addedConsensusState: {
        height: string | number | bigint;
        value: Buffer;
    } | undefined): UpdateClientStateRootResult;
    computeRootWithCreateConnectionUpdate(oldRoot: string, connectionId: string, connectionValue: Buffer): CreateConnectionStateRootResult;
    computeRootWithCreateChannelUpdate(oldRoot: string, portId: string, channelId: string, channelValue: Buffer, nextSequenceSendValue: Buffer, nextSequenceRecvValue: Buffer, nextSequenceAckValue: Buffer): CreateChannelStateRootResult;
    computeRootWithUpdateChannelUpdate(oldRoot: string, portId: string, channelId: string, channelValue: Buffer): UpdateChannelStateRootResult;
    computeRootWithPrunePacketHistoryUpdate(oldRoot: string, portId: string, channelId: string, sequence: bigint, ordering: 'None' | 'Unordered' | 'Ordered'): PrunePacketHistoryStateRootResult;
    computeRootWithPortBind(oldRoot: string, portId: string, portValue: Buffer): BindPortStateRootResult;
    getCurrentTree(): ICS23MerkleTree;
    setCurrentTree(tree: ICS23MerkleTree): void;
    getCurrentRoot(): string;
    resetTreeState(): void;
}
export {};
