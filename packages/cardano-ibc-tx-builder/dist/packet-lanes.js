"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PACKET_SEQUENCE = exports.MAX_PACKET_LANES = void 0;
exports.validateLaneCount = validateLaneCount;
exports.packetLane = packetLane;
exports.parsePacketKey = parsePacketKey;
exports.packetKeyLane = packetKeyLane;
exports.packetLaneTokenName = packetLaneTokenName;
exports.sendSequencerTokenName = sendSequencerTokenName;
exports.liquidityTokenName = liquidityTokenName;
const sha256_1 = require("@noble/hashes/sha256");
exports.MAX_PACKET_LANES = 64;
exports.MAX_PACKET_SEQUENCE = (1n << 64n) - 1n;
const encoder = new TextEncoder();
function concat(...parts) {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
function unsigned(value, width) {
    if (value < 0n || value >= 1n << BigInt(width * 8)) {
        throw new Error(`Value does not fit uint${width * 8}`);
    }
    const bytes = new Uint8Array(width);
    for (let index = width - 1; index >= 0; index--) {
        bytes[index] = Number(value & 255n);
        value >>= 8n;
    }
    return bytes;
}
function framed(value) {
    const bytes = encoder.encode(value);
    return concat(unsigned(BigInt(bytes.length), 4), bytes);
}
function domain(value) {
    return concat(encoder.encode(`cardano-ibc/${value}/v1`), new Uint8Array([0]));
}
function validateLaneCount(count) {
    if (!Number.isInteger(count) || count < 1 || count > exports.MAX_PACKET_LANES) {
        throw new Error(`Packet lane count must be between 1 and ${exports.MAX_PACKET_LANES}`);
    }
}
function validateChannel(port, channel) {
    if (!/^[a-zA-Z0-9._+\-#\[\]<>]{2,128}$/.test(port) ||
        !/^channel-(0|[1-9][0-9]*)$/.test(channel) ||
        BigInt(channel.slice(8)) > exports.MAX_PACKET_SEQUENCE) {
        throw new Error("Invalid packet lane port or channel");
    }
}
/** All three packet keys for a sequence use the same local channel lane. */
function packetLane(port, channel, sequence, count) {
    validateLaneCount(count);
    validateChannel(port, channel);
    if (sequence <= 0n || sequence > exports.MAX_PACKET_SEQUENCE) {
        throw new Error("Packet sequence must be a positive uint64");
    }
    return Number(sequence % BigInt(count));
}
/** Reject aliases so every accepted proof key has exactly one lane assignment. */
function parsePacketKey(key) {
    const match = /^(commitments|receipts|acks)\/ports\/([^/]+)\/channels\/(channel-(?:0|[1-9][0-9]*))\/sequences\/([1-9][0-9]*)$/.exec(key);
    if (!match)
        throw new Error("Not a canonical packet key");
    const [, kind, port, channel, rawSequence] = match;
    validateChannel(port, channel);
    const sequence = BigInt(rawSequence);
    if (sequence > exports.MAX_PACKET_SEQUENCE)
        throw new Error("Packet sequence exceeds uint64");
    return { kind: kind, port, channel, sequence };
}
function packetKeyLane(key, count) {
    const { port, channel, sequence } = parsePacketKey(key);
    return packetLane(port, channel, sequence, count);
}
function hex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function packetLaneTokenName(port, channel, lane, count) {
    validateChannel(port, channel);
    validateLaneCount(count);
    if (!Number.isInteger(lane) || lane < 0 || lane >= count)
        throw new Error("Invalid packet lane");
    return hex((0, sha256_1.sha256)(concat(domain("packet-lane-token"), framed(port), framed(channel), unsigned(BigInt(lane), 4))));
}
function sendSequencerTokenName(port, channel) {
    validateChannel(port, channel);
    return hex((0, sha256_1.sha256)(concat(domain("send-sequencer-token"), framed(port), framed(channel))));
}
/** A consumed deposit input gives each liquidity output a unique identity. */
function liquidityTokenName(port, channel, denom, depositTxHash, depositOutputIndex) {
    validateChannel(port, channel);
    if (!denom ||
        !/^[0-9a-f]{64}$/.test(depositTxHash) ||
        !Number.isInteger(depositOutputIndex) ||
        depositOutputIndex < 0 ||
        depositOutputIndex > 0xffffffff) {
        throw new Error("Invalid liquidity deposit identity");
    }
    const txHash = Uint8Array.from(depositTxHash.match(/../g), (byte) => parseInt(byte, 16));
    return hex((0, sha256_1.sha256)(concat(domain("transfer-liquidity-token"), framed(port), framed(channel), framed(denom), txHash, unsigned(BigInt(depositOutputIndex), 4))));
}
