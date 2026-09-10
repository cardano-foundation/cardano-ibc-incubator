"use strict";
// Merkle tree implementation used for `ibc_state_root`.
//
// The key goal of this tree is not "fast inserts", it is "deterministic roots"
// plus the ability to produce compact per-key proofs and per-key update
// witnesses.
//
// This implementation is intentionally simple:
// - Keys are mapped to a fixed-depth binary tree via `sha256(key)`.
// - Each stored value is hashed first, so leaves always commit to 32 bytes.
// - Empty subtrees are represented by a 32-byte zero hash.
//
// This matches the on-chain `ibc_state_commitment.ak` logic used by `host_state_stt`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICS23MerkleTree = void 0;
const js_sha256_1 = require("js-sha256");
const node_buffer_1 = require("node:buffer");
const MERKLE_DEPTH_BITS = 64;
const HASH_SIZE_BYTES = 32;
const EMPTY_HASH = node_buffer_1.Buffer.alloc(HASH_SIZE_BYTES, 0);
function sha256Bytes(data) {
    return node_buffer_1.Buffer.from(js_sha256_1.sha256.array(data));
}
function keyHash(key) {
    return sha256Bytes(node_buffer_1.Buffer.from(key, 'utf8'));
}
function leafHash(key, value) {
    // On-chain we treat the empty value as "absent" and map it to the all-zero hash.
    if (value.length === 0)
        return EMPTY_HASH;
    // leaf = sha256(0x00 || sha256(key) || sha256(value))
    const valueHash = sha256Bytes(value);
    return sha256Bytes(node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([0x00]), keyHash(key), valueHash]));
}
function innerHash(left, right) {
    // Empty subtree compression: if both children are empty, parent is empty.
    if (left.equals(EMPTY_HASH) && right.equals(EMPTY_HASH))
        return EMPTY_HASH;
    // inner = sha256(0x01 || left || right)
    return sha256Bytes(node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([0x01]), left, right]));
}
function keyIndex64(key) {
    // The on-chain code uses the first 64 bits of `sha256(key)` to define the path.
    // We interpret those 8 bytes as a big-endian unsigned integer.
    const first8 = keyHash(key).subarray(0, 8);
    return BigInt(`0x${first8.toString('hex')}`);
}
/**
 * Fixed-depth Merkle tree keyed by `sha256(key)`.
 */
class ICS23MerkleTree {
    leaves = new Map();
    root = EMPTY_HASH;
    dirty = true;
    nodesByHeight = null;
    clone() {
        const cloned = new ICS23MerkleTree();
        for (const [key, value] of this.leaves) {
            cloned.leaves.set(key, node_buffer_1.Buffer.from(value));
        }
        cloned.dirty = true;
        return cloned;
    }
    set(key, value) {
        const valueBuffer = typeof value === 'string' ? node_buffer_1.Buffer.from(value, 'hex') : value;
        // Empty values are treated as "absent" in this commitment scheme, so we
        // model them as deletion to avoid ambiguous state.
        if (valueBuffer.length === 0) {
            this.leaves.delete(key);
        }
        else {
            this.leaves.set(key, valueBuffer);
        }
        this.dirty = true;
    }
    get(key) {
        return this.leaves.get(key);
    }
    delete(key) {
        this.leaves.delete(key);
        this.dirty = true;
    }
    size() {
        return this.leaves.size;
    }
    getKeys() {
        return Array.from(this.leaves.keys());
    }
    getRoot() {
        this.ensureRebuilt();
        return this.root.toString('hex');
    }
    /**
     * Return the per-level sibling hashes for this key, even if the key is not present.
     *
     * This is the exact structure we use as an on-chain update witness.
     */
    getSiblings(key) {
        this.ensureRebuilt();
        const siblings = [];
        let index = keyIndex64(key);
        for (let height = 0; height < MERKLE_DEPTH_BITS; height++) {
            const siblingIndex = index ^ 1n;
            const siblingHash = this.nodesByHeight[height].get(siblingIndex) ?? EMPTY_HASH;
            siblings.push(node_buffer_1.Buffer.from(siblingHash));
            index >>= 1n;
        }
        return siblings;
    }
    /**
     * Generate a membership proof for an existing key.
     */
    generateProof(key) {
        if (this.leaves.size === 0) {
            throw new Error(`Cannot generate proof: tree is empty`);
        }
        const value = this.leaves.get(key);
        if (!value) {
            throw new Error(`Cannot generate proof: key '${key}' not found in tree`);
        }
        const siblings = this.getSiblings(key);
        const path = [];
        let index = keyIndex64(key);
        for (const siblingHash of siblings) {
            const isLeftChild = (index & 1n) === 0n;
            if (isLeftChild) {
                path.push({
                    hash: 1, // SHA-256
                    prefix: node_buffer_1.Buffer.from([0x01]),
                    suffix: siblingHash,
                });
            }
            else {
                path.push({
                    hash: 1, // SHA-256
                    prefix: node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([0x01]), siblingHash]),
                    suffix: node_buffer_1.Buffer.alloc(0),
                });
            }
            index >>= 1n;
        }
        return {
            key: node_buffer_1.Buffer.from(key, 'utf8'),
            value,
            // These fields are carried through for compatibility and potential future
            // tooling. Our current verification logic does not rely on them.
            leaf: {
                hash: 1,
                prehash_key: 0,
                prehash_value: 0,
                length: 0,
                prefix: node_buffer_1.Buffer.alloc(0),
            },
            path,
        };
    }
    /**
     * Generate a non-membership proof for a missing key.
     *
     * For this fixed-depth tree, we model "missing" as "present with an empty value".
     * The leaf hash for an empty value is the all-zero hash.
     */
    generateNonExistenceProof(key) {
        if (this.leaves.has(key)) {
            throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
        }
        if (this.leaves.size === 0) {
            throw new Error(`Cannot generate non-existence proof: tree is empty`);
        }
        const siblings = this.getSiblings(key);
        const path = [];
        let index = keyIndex64(key);
        for (const siblingHash of siblings) {
            const isLeftChild = (index & 1n) === 0n;
            if (isLeftChild) {
                path.push({
                    hash: 1,
                    prefix: node_buffer_1.Buffer.from([0x01]),
                    suffix: siblingHash,
                });
            }
            else {
                path.push({
                    hash: 1,
                    prefix: node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([0x01]), siblingHash]),
                    suffix: node_buffer_1.Buffer.alloc(0),
                });
            }
            index >>= 1n;
        }
        const emptyValueProof = {
            key: node_buffer_1.Buffer.from(key, 'utf8'),
            value: node_buffer_1.Buffer.alloc(0),
            leaf: {
                hash: 1,
                prehash_key: 0,
                prehash_value: 0,
                length: 0,
                prefix: node_buffer_1.Buffer.alloc(0),
            },
            path,
        };
        return {
            key: node_buffer_1.Buffer.from(key, 'utf8'),
            left: emptyValueProof,
            right: null,
        };
    }
    /**
     * Verify a proof against the current tree root.
     *
     * This is primarily used by unit tests to sanity-check the proof generator.
     */
    verifyProof(proof) {
        this.ensureRebuilt();
        const proofKey = proof.key.toString('utf8');
        let currentHash = leafHash(proofKey, proof.value);
        for (const op of proof.path) {
            if (op.suffix.length > 0) {
                const left = currentHash;
                const right = op.suffix;
                currentHash = innerHash(left, right);
            }
            else {
                // prefix format: 0x01 || leftSiblingHash
                const leftSibling = op.prefix.subarray(1);
                const left = leftSibling;
                const right = currentHash;
                currentHash = innerHash(left, right);
            }
        }
        return currentHash.equals(this.root);
    }
    toJSON() {
        const leaves = {};
        this.leaves.forEach((value, key) => {
            leaves[key] = value.toString('hex');
        });
        return { leaves, root: this.getRoot() };
    }
    static fromJSON(data) {
        const tree = new ICS23MerkleTree();
        for (const [key, value] of Object.entries(data.leaves)) {
            tree.set(key, node_buffer_1.Buffer.from(value, 'hex'));
        }
        return tree;
    }
    ensureRebuilt() {
        if (!this.dirty && this.nodesByHeight)
            return;
        const nodesByHeight = Array.from({ length: MERKLE_DEPTH_BITS + 1 }, () => new Map());
        const indexToKey = new Map();
        for (const [key, value] of this.leaves) {
            const index = keyIndex64(key);
            const previousKey = indexToKey.get(index);
            if (previousKey && previousKey !== key) {
                throw new Error(`Merkle key collision at index ${index.toString()}: '${previousKey}' and '${key}'`);
            }
            indexToKey.set(index, key);
            const h = leafHash(key, value);
            if (!h.equals(EMPTY_HASH))
                nodesByHeight[0].set(index, h);
        }
        for (let height = 1; height <= MERKLE_DEPTH_BITS; height++) {
            const childMap = nodesByHeight[height - 1];
            const parentMap = nodesByHeight[height];
            const parents = new Set();
            for (const childIndex of childMap.keys()) {
                parents.add(childIndex >> 1n);
            }
            for (const parentIndex of parents) {
                const leftIndex = parentIndex << 1n;
                const rightIndex = leftIndex + 1n;
                const left = childMap.get(leftIndex) ?? EMPTY_HASH;
                const right = childMap.get(rightIndex) ?? EMPTY_HASH;
                const p = innerHash(left, right);
                if (!p.equals(EMPTY_HASH))
                    parentMap.set(parentIndex, p);
            }
        }
        this.nodesByHeight = nodesByHeight;
        this.root = nodesByHeight[MERKLE_DEPTH_BITS].get(0n) ?? EMPTY_HASH;
        this.dirty = false;
    }
}
exports.ICS23MerkleTree = ICS23MerkleTree;
