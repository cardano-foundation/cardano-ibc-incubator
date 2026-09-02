export declare const ICS20_CLASSIC_JSON_LIMITS: Readonly<{
    packetBytes: 512;
    denomBytes: 256;
    amountBytes: 78;
    senderBytes: 256;
    receiverBytes: 256;
    memoBytes: 512;
}>;
export type Ics20ClassicPacketData = {
    denom: string;
    amount: string;
    sender: string;
    receiver: string;
    memo?: string;
};
export type Ics20ClassicJsonProfile = 'cardano-js-sorted' | 'ibc-go-v8-sorted' | 'ibc-go-v10' | 'ibc-rs-v0.53';
export type DecodedIcs20ClassicPacketData = {
    data: Required<Ics20ClassicPacketData>;
    profiles: readonly Ics20ClassicJsonProfile[];
    json: string;
};
export type Ics20ClassicJsonCodecErrorCode = 'packet_too_large' | 'invalid_utf8' | 'malformed_json' | 'invalid_shape' | 'field_too_large' | 'non_canonical';
export declare class Ics20ClassicJsonCodecError extends Error {
    readonly code: Ics20ClassicJsonCodecErrorCode;
    constructor(code: Ics20ClassicJsonCodecErrorCode, message: string);
}
/** Emit Cardano's existing sorted JavaScript JSON representation. */
export declare function stringifyIcs20PacketData(packetData: Ics20ClassicPacketData): string;
/** Emit Cardano's existing sorted JavaScript JSON representation as UTF-8. */
export declare function encodeIcs20ClassicPacketData(packetData: Ics20ClassicPacketData): Uint8Array;
/**
 * Decode only the canonical packet bytes emitted by Cardano, ibc-go v8,
 * ibc-go v10, or ibc-rs v0.53. More than one profile can match when their
 * bytes are identical.
 */
export declare function decodeIcs20ClassicPacketData(packetBytes: Uint8Array): DecodedIcs20ClassicPacketData;
