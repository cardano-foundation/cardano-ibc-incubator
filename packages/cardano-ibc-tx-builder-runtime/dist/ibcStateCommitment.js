"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_HASH = exports.MERKLE_DEPTH_BITS = void 0;
exports.hash = hash;
exports.keyHash = keyHash;
exports.innerHash = innerHash;
exports.bucketHash = bucketHash;
exports.encodeBucket = encodeBucket;
exports.sortBucket = sortBucket;
exports.needsBucketWitness = needsBucketWitness;
exports.witnessLeaf = witnessLeaf;
const node_buffer_1 = require("node:buffer");
const node_crypto_1 = require("node:crypto");
exports.MERKLE_DEPTH_BITS = 64;
exports.EMPTY_HASH = node_buffer_1.Buffer.alloc(32);
const EMPTY_VALUE_HASH = hash(node_buffer_1.Buffer.alloc(0));
function hash(bytes) {
    return (0, node_crypto_1.createHash)('sha256').update(bytes).digest();
}
function keyHash(key) {
    const bytes = node_buffer_1.Buffer.from(key, 'utf8');
    if (bytes.toString('utf8') !== key)
        throw new Error('IBC tree key must be a well-formed UTF-8 string');
    return hash(bytes);
}
function leafHash(keyDigest, valueDigest) {
    if (valueDigest.equals(EMPTY_VALUE_HASH))
        return exports.EMPTY_HASH;
    return hash(node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([0]), keyDigest, valueDigest]));
}
function innerHash(left, right) {
    if (left.equals(exports.EMPTY_HASH) && right.equals(exports.EMPTY_HASH))
        return exports.EMPTY_HASH;
    return hash(node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([1]), left, right]));
}
// Empty and singleton positions retain their existing commitments. A collision
// commits to every full key/value digest in strictly increasing key-hash order.
function bucketHash(entries) {
    if (entries.length === 0)
        return exports.EMPTY_HASH;
    if (entries.length === 1)
        return leafHash(entries[0].keyHash, entries[0].valueHash);
    return hash(encodeBucket(entries));
}
function encodeBucket(entries) {
    return node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([2]), ...entries.flatMap((entry) => [entry.keyHash, entry.valueHash])]);
}
function sortBucket(entries) {
    entries.sort((a, b) => node_buffer_1.Buffer.compare(a.keyHash, b.keyHash));
    // Reuse the wire checks so rebuilding cannot silently discard a full-hash
    // collision or produce a commitment that the validators cannot interpret.
    if (entries.length)
        decodeBucket(encodeBucket(entries), entries[0].keyHash);
    return entries;
}
function decodeBucket(encoded, requestedKeyHash) {
    if (encoded[0] !== 2 || encoded.length < 65 || (encoded.length - 1) % 64 !== 0) {
        throw new Error('Invalid collision bucket encoding');
    }
    const entries = [];
    for (let offset = 1; offset < encoded.length; offset += 64) {
        const entry = { keyHash: encoded.subarray(offset, offset + 32), valueHash: encoded.subarray(offset + 32, offset + 64) };
        if (!entry.keyHash.subarray(0, 8).equals(requestedKeyHash.subarray(0, 8))) {
            throw new Error('Collision bucket entry belongs to a different path');
        }
        if (entry.valueHash.equals(EMPTY_VALUE_HASH))
            throw new Error('Collision bucket contains an empty value');
        if (entries.length && node_buffer_1.Buffer.compare(entries[entries.length - 1].keyHash, entry.keyHash) >= 0) {
            throw new Error('Collision bucket keys must be strictly ordered');
        }
        entries.push(entry);
    }
    return entries;
}
function requireBucketValue(entries, requestedKeyHash, value) {
    const entry = entries.find((candidate) => candidate.keyHash.equals(requestedKeyHash));
    if (value.length === 0 ? entry !== undefined : !entry?.valueHash.equals(hash(value))) {
        throw new Error('Collision bucket does not contain the claimed key and value');
    }
}
function needsBucketWitness(entries, requestedKeyHash) {
    return entries.length > 1 || (entries.length === 1 && !entries[0].keyHash.equals(requestedKeyHash));
}
// A bucket descriptor precedes the usual 64 siblings only when the position
// contains another key. The existing redeemer list and protobuf path can carry
// it without adding a new datum or proof type.
function witnessLeaf(digest, value, witness) {
    if (witness.length === exports.MERKLE_DEPTH_BITS + 1) {
        const entries = decodeBucket(witness[0], digest);
        requireBucketValue(entries, digest, value);
        return { leaf: bucketHash(entries), siblings: witness.slice(1) };
    }
    if (witness.length !== exports.MERKLE_DEPTH_BITS)
        throw new Error('IBC tree witness must have 64 siblings and at most one bucket descriptor');
    return { leaf: leafHash(digest, hash(value)), siblings: witness };
}
