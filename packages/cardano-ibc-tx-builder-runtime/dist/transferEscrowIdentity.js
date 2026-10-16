"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferEscrowShardTokenName = transferEscrowShardTokenName;
exports.transferEscrowShardRegistryKey = transferEscrowShardRegistryKey;
exports.escrowDenomTokenFromPacketDenom = escrowDenomTokenFromPacketDenom;
const node_buffer_1 = require("node:buffer");
const blake2b_1 = require("@noble/hashes/blake2b");
const TRANSFER_ESCROW_SHARD_NAME_DOMAIN = node_buffer_1.Buffer.from('cardano-ibc/transfer-escrow-shard/v1', 'utf8');
const UINT32_MAX = 0xffff_ffff;
function decodeHexBytes(value, label) {
    if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`${label} must be an even-length hexadecimal string`);
    }
    return node_buffer_1.Buffer.from(value, 'hex');
}
function uint32BigEndian(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new Error(`Escrow shard framing length ${value} exceeds uint32`);
    }
    const encoded = node_buffer_1.Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    return encoded;
}
function transferEscrowShardTokenName(channelId, packetDenom) {
    const channelBytes = decodeHexBytes(channelId, 'channelId');
    const denomBytes = decodeHexBytes(packetDenom, 'packetDenom');
    return node_buffer_1.Buffer.from((0, blake2b_1.blake2b)(node_buffer_1.Buffer.concat([
        TRANSFER_ESCROW_SHARD_NAME_DOMAIN,
        node_buffer_1.Buffer.from([0]),
        uint32BigEndian(channelBytes.length),
        channelBytes,
        uint32BigEndian(denomBytes.length),
        denomBytes,
    ]), { dkLen: 28 })).toString('hex');
}
function transferEscrowShardRegistryKey(tokenName) {
    if (!/^[0-9a-fA-F]{56}$/.test(tokenName)) {
        throw new Error('Escrow shard token name must be a 28-byte hexadecimal string');
    }
    return `escrowShards/${tokenName.toLowerCase()}`;
}
function escrowDenomTokenFromPacketDenom(encodedDenom) {
    const packetDenomBytes = decodeHexBytes(encodedDenom, 'transfer escrow shard datum denom');
    const packetDenom = packetDenomBytes.toString('utf8');
    if (!node_buffer_1.Buffer.from(packetDenom, 'utf8').equals(packetDenomBytes)) {
        throw new Error('Transfer escrow shard datum denom is not canonical UTF-8');
    }
    if (packetDenom.toLowerCase() === node_buffer_1.Buffer.from('lovelace').toString('hex')) {
        return 'lovelace';
    }
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(packetDenom)) {
        throw new Error('Transfer escrow shard datum contains a non-hex denomination');
    }
    if (packetDenom.length < 56 || packetDenom.length > 120) {
        throw new Error('Transfer escrow shard datum contains an invalid Cardano asset unit');
    }
    return packetDenom.toLowerCase();
}
