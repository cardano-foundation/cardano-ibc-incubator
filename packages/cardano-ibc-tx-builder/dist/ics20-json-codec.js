"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ics20ClassicJsonCodecError = exports.ICS20_CLASSIC_JSON_LIMITS = void 0;
exports.stringifyIcs20PacketData = stringifyIcs20PacketData;
exports.encodeIcs20ClassicPacketData = encodeIcs20ClassicPacketData;
exports.decodeIcs20ClassicPacketData = decodeIcs20ClassicPacketData;
exports.ICS20_CLASSIC_JSON_LIMITS = Object.freeze({
    packetBytes: 512,
    denomBytes: 256,
    amountBytes: 78,
    senderBytes: 256,
    receiverBytes: 256,
    memoBytes: 512,
});
class Ics20ClassicJsonCodecError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'Ics20ClassicJsonCodecError';
    }
}
exports.Ics20ClassicJsonCodecError = Ics20ClassicJsonCodecError;
const REQUIRED_KEYS = ['denom', 'amount', 'sender', 'receiver'];
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'memo']);
const CARDANO_AND_IBC_GO_V8_ORDER = ['amount', 'denom', 'memo', 'receiver', 'sender'];
const IBC_GO_V10_ORDER = ['denom', 'amount', 'sender', 'receiver', 'memo'];
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', {
    fatal: true,
    // Keep a leading BOM in the decoded string so it cannot disappear before
    // the exact canonical-byte check.
    ignoreBOM: true,
});
const FIELD_LIMITS = {
    denom: exports.ICS20_CLASSIC_JSON_LIMITS.denomBytes,
    amount: exports.ICS20_CLASSIC_JSON_LIMITS.amountBytes,
    sender: exports.ICS20_CLASSIC_JSON_LIMITS.senderBytes,
    receiver: exports.ICS20_CLASSIC_JSON_LIMITS.receiverBytes,
    memo: exports.ICS20_CLASSIC_JSON_LIMITS.memoBytes,
};
function codecError(code, message) {
    return new Ics20ClassicJsonCodecError(code, message);
}
function hasUnpairedSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            if (index + 1 >= value.length)
                return true;
            const nextCodeUnit = value.charCodeAt(index + 1);
            if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff)
                return true;
            index += 1;
        }
        else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return true;
        }
    }
    return false;
}
function validatePacketData(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw codecError('invalid_shape', 'ICS-20 packet data must be a JSON object');
    }
    const record = value;
    const keys = Object.keys(record);
    const unknownKey = keys.find((key) => !ALLOWED_KEYS.has(key));
    if (unknownKey !== undefined) {
        throw codecError('invalid_shape', `ICS-20 packet data contains unknown field "${unknownKey}"`);
    }
    for (const key of REQUIRED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            throw codecError('invalid_shape', `ICS-20 packet data is missing required field "${key}"`);
        }
    }
    const hasMemo = Object.prototype.hasOwnProperty.call(record, 'memo');
    if (hasMemo && record.memo !== undefined && typeof record.memo !== 'string') {
        throw codecError('invalid_shape', 'ICS-20 packet data field "memo" must be a string');
    }
    for (const key of REQUIRED_KEYS) {
        if (typeof record[key] !== 'string') {
            throw codecError('invalid_shape', `ICS-20 packet data field "${key}" must be a string`);
        }
        if (record[key].length === 0) {
            throw codecError('invalid_shape', `ICS-20 packet data field "${key}" must not be empty`);
        }
    }
    const packet = {
        denom: record.denom,
        amount: record.amount,
        sender: record.sender,
        receiver: record.receiver,
        memo: hasMemo ? (record.memo ?? '') : '',
    };
    for (const key of Object.keys(FIELD_LIMITS)) {
        const fieldValue = packet[key];
        if (hasUnpairedSurrogate(fieldValue)) {
            throw codecError('invalid_utf8', `ICS-20 packet data field "${key}" contains an invalid Unicode surrogate`);
        }
        const byteLength = UTF8_ENCODER.encode(fieldValue).byteLength;
        if (byteLength > FIELD_LIMITS[key]) {
            throw codecError('field_too_large', `ICS-20 packet data field "${key}" exceeds ${FIELD_LIMITS[key]} UTF-8 bytes`);
        }
    }
    return packet;
}
function packetInOrder(packet, order) {
    const ordered = {};
    for (const key of order) {
        if (key !== 'memo' || packet.memo !== '')
            ordered[key] = packet[key];
    }
    return ordered;
}
function stringifyCardanoPacket(packet) {
    return JSON.stringify(packetInOrder(packet, CARDANO_AND_IBC_GO_V8_ORDER));
}
function quoteGoJsonString(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function stringifyGoPacket(packet, order) {
    const fields = [];
    for (const key of order) {
        if (key === 'memo' && packet.memo === '')
            continue;
        fields.push(`${JSON.stringify(key)}:${quoteGoJsonString(packet[key])}`);
    }
    return `{${fields.join(',')}}`;
}
function ensurePacketSize(json) {
    const byteLength = UTF8_ENCODER.encode(json).byteLength;
    if (byteLength > exports.ICS20_CLASSIC_JSON_LIMITS.packetBytes) {
        throw codecError('packet_too_large', `ICS-20 packet data exceeds ${exports.ICS20_CLASSIC_JSON_LIMITS.packetBytes} bytes`);
    }
}
function bytesEqual(left, right) {
    if (left.byteLength !== right.byteLength)
        return false;
    return left.every((byte, index) => byte === right[index]);
}
/** Emit Cardano's existing sorted JavaScript JSON representation. */
function stringifyIcs20PacketData(packetData) {
    const packet = validatePacketData(packetData);
    const json = stringifyCardanoPacket(packet);
    ensurePacketSize(json);
    return json;
}
/** Emit Cardano's existing sorted JavaScript JSON representation as UTF-8. */
function encodeIcs20ClassicPacketData(packetData) {
    return UTF8_ENCODER.encode(stringifyIcs20PacketData(packetData));
}
/**
 * Decode only the canonical packet bytes emitted by Cardano, ibc-go v8, or
 * ibc-go v10. More than one profile can match when their bytes are identical.
 */
function decodeIcs20ClassicPacketData(packetBytes) {
    if (!(packetBytes instanceof Uint8Array)) {
        throw codecError('invalid_shape', 'ICS-20 packet data must be bytes');
    }
    if (packetBytes.byteLength > exports.ICS20_CLASSIC_JSON_LIMITS.packetBytes) {
        throw codecError('packet_too_large', `ICS-20 packet data exceeds ${exports.ICS20_CLASSIC_JSON_LIMITS.packetBytes} bytes`);
    }
    let json;
    try {
        json = UTF8_DECODER.decode(packetBytes);
    }
    catch {
        throw codecError('invalid_utf8', 'ICS-20 packet data is not valid UTF-8');
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw codecError('malformed_json', 'ICS-20 packet data is not valid JSON');
    }
    const packet = validatePacketData(parsed);
    const candidates = [
        ['cardano-js-sorted', stringifyCardanoPacket(packet)],
        ['ibc-go-v8-sorted', stringifyGoPacket(packet, CARDANO_AND_IBC_GO_V8_ORDER)],
        ['ibc-go-v10', stringifyGoPacket(packet, IBC_GO_V10_ORDER)],
    ];
    const profiles = candidates
        .filter(([, candidate]) => candidate === json && bytesEqual(UTF8_ENCODER.encode(candidate), packetBytes))
        .map(([profile]) => profile);
    if (profiles.length === 0) {
        throw codecError('non_canonical', 'ICS-20 packet data does not use a supported canonical JSON encoding');
    }
    return { data: packet, profiles, json };
}
