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
const node_buffer_1 = require("node:buffer");
const ibcStateCommitment_ts_1 = require("./ibcStateCommitment.js");
function keyIndex64(key) {
    return (0, ibcStateCommitment_ts_1.keyHash)(key).readBigUInt64BE();
}
/**
 * Fixed-depth Merkle tree keyed by `sha256(key)`.
 */
class ICS23MerkleTree {
    leaves = new Map();
    buckets = new Map();
    root = ibcStateCommitment_ts_1.EMPTY_HASH;
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
     * An occupied collision position prepends its complete bucket descriptor.
     * This is the exact structure we use as an on-chain update witness.
     */
    getSiblings(key) {
        this.ensureRebuilt();
        const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
        let index = digest.readBigUInt64BE();
        const bucket = this.buckets.get(index) ?? [];
        const siblings = (0, ibcStateCommitment_ts_1.needsBucketWitness)(bucket, digest) ? [(0, ibcStateCommitment_ts_1.encodeBucket)(bucket)] : [];
        for (let height = 0; height < ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS; height++) {
            const siblingIndex = index ^ 1n;
            const siblingHash = this.nodesByHeight[height].get(siblingIndex) ?? ibcStateCommitment_ts_1.EMPTY_HASH;
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
        const path = this.proofPath(key);
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
     * An empty value claims absence of this full key. At an occupied collision
     * position the proof includes the bucket to show that its other keys remain.
     */
    generateNonExistenceProof(key) {
        if (this.leaves.has(key)) {
            throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
        }
        if (this.leaves.size === 0) {
            throw new Error(`Cannot generate non-existence proof: tree is empty`);
        }
        const path = this.proofPath(key);
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
        try {
            const key = proof.key.toString('utf8');
            if (!node_buffer_1.Buffer.from(key, 'utf8').equals(proof.key))
                return false;
            const hasBucket = proof.path.length === ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS + 1;
            const operations = hasBucket ? proof.path.slice(1) : proof.path;
            const witness = [];
            if (hasBucket) {
                const descriptor = proof.path[0];
                if (!descriptor || descriptor.hash !== 1 || descriptor.suffix.length !== 0)
                    return false;
                witness.push(descriptor.prefix);
            }
            if (operations.length !== ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS)
                return false;
            let index = keyIndex64(key);
            for (const op of operations) {
                if (!op || op.hash !== 1)
                    return false;
                if ((index & 1n) === 0n) {
                    if (!op.prefix.equals(node_buffer_1.Buffer.from([1])) || op.suffix.length !== 32)
                        return false;
                    witness.push(op.suffix);
                }
                else {
                    if (op.suffix.length !== 0 || op.prefix.length !== 33 || op.prefix[0] !== 1)
                        return false;
                    witness.push(op.prefix.subarray(1));
                }
                index >>= 1n;
            }
            const { leaf, siblings } = (0, ibcStateCommitment_ts_1.witnessLeaf)((0, ibcStateCommitment_ts_1.keyHash)(key), proof.value, witness);
            let current = leaf;
            index = keyIndex64(key);
            for (const sibling of siblings) {
                current = (index & 1n) === 0n ? (0, ibcStateCommitment_ts_1.innerHash)(current, sibling) : (0, ibcStateCommitment_ts_1.innerHash)(sibling, current);
                index >>= 1n;
            }
            return current.equals(this.root);
        }
        catch {
            return false;
        }
    }
    proofPath(key) {
        const witness = this.getSiblings(key);
        const hasBucket = witness.length === ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS + 1;
        const siblings = hasBucket ? witness.slice(1) : witness;
        const path = hasBucket ? [{ hash: 1, prefix: witness[0], suffix: node_buffer_1.Buffer.alloc(0) }] : [];
        let index = keyIndex64(key);
        for (const sibling of siblings) {
            path.push((index & 1n) === 0n
                ? { hash: 1, prefix: node_buffer_1.Buffer.from([1]), suffix: sibling }
                : { hash: 1, prefix: node_buffer_1.Buffer.concat([node_buffer_1.Buffer.from([1]), sibling]), suffix: node_buffer_1.Buffer.alloc(0) });
            index >>= 1n;
        }
        return path;
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
        const nodesByHeight = Array.from({ length: ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS + 1 }, () => new Map());
        const buckets = new Map();
        for (const [key, value] of this.leaves) {
            const digest = (0, ibcStateCommitment_ts_1.keyHash)(key);
            const index = digest.readBigUInt64BE();
            const bucket = buckets.get(index) ?? [];
            bucket.push({ keyHash: digest, valueHash: (0, ibcStateCommitment_ts_1.hash)(value) });
            buckets.set(index, bucket);
        }
        for (const [index, bucket] of buckets) {
            nodesByHeight[0].set(index, (0, ibcStateCommitment_ts_1.bucketHash)((0, ibcStateCommitment_ts_1.sortBucket)(bucket)));
        }
        for (let height = 1; height <= ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS; height++) {
            const childMap = nodesByHeight[height - 1];
            const parentMap = nodesByHeight[height];
            const parents = new Set();
            for (const childIndex of childMap.keys()) {
                parents.add(childIndex >> 1n);
            }
            for (const parentIndex of parents) {
                const leftIndex = parentIndex << 1n;
                const rightIndex = leftIndex + 1n;
                const left = childMap.get(leftIndex) ?? ibcStateCommitment_ts_1.EMPTY_HASH;
                const right = childMap.get(rightIndex) ?? ibcStateCommitment_ts_1.EMPTY_HASH;
                const p = (0, ibcStateCommitment_ts_1.innerHash)(left, right);
                if (!p.equals(ibcStateCommitment_ts_1.EMPTY_HASH))
                    parentMap.set(parentIndex, p);
            }
        }
        this.buckets = buckets;
        this.nodesByHeight = nodesByHeight;
        this.root = nodesByHeight[ibcStateCommitment_ts_1.MERKLE_DEPTH_BITS].get(0n) ?? ibcStateCommitment_ts_1.EMPTY_HASH;
        this.dirty = false;
    }
}
exports.ICS23MerkleTree = ICS23MerkleTree;
