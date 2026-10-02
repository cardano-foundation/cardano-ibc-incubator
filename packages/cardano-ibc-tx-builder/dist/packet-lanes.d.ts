export declare const MAX_PACKET_LANES = 64;
export declare const MAX_PACKET_SEQUENCE: bigint;
export declare function validateLaneCount(count: number): void;
/** All three packet keys for a sequence use the same local channel lane. */
export declare function packetLane(port: string, channel: string, sequence: bigint, count: number): number;
export type PacketKey = {
    kind: "commitments" | "receipts" | "acks";
    port: string;
    channel: string;
    sequence: bigint;
};
/** Reject aliases so every accepted proof key has exactly one lane assignment. */
export declare function parsePacketKey(key: string): PacketKey;
export declare function packetKeyLane(key: string, count: number): number;
export declare function packetLaneTokenName(port: string, channel: string, lane: number, count: number): string;
export declare function sendSequencerTokenName(port: string, channel: string): string;
/** A consumed deposit input gives each liquidity output a unique identity. */
export declare function liquidityTokenName(port: string, channel: string, denom: string, depositTxHash: string, depositOutputIndex: number): string;
