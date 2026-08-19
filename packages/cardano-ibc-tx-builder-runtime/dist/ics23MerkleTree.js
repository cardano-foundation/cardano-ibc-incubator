"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICS23MerkleTree = void 0;
const js_sha256_1 = require("js-sha256");
const MERKLE_DEPTH_BITS = 64;
const HASH_SIZE_BYTES = 32;
const EMPTY_HASH = Buffer.alloc(HASH_SIZE_BYTES, 0);
function sha256Bytes(data) {
    return Buffer.from(js_sha256_1.sha256.array(data));
}
function leafHash(key, value) {
    if (value.length === 0) {
        return EMPTY_HASH;
    }
    const keyHash = sha256Bytes(Buffer.from(key, 'utf8'));
    const valueHash = sha256Bytes(value);
    return sha256Bytes(Buffer.concat([Buffer.from([0x00]), keyHash, valueHash]));
}
function innerHash(left, right) {
    if (left.equals(EMPTY_HASH) && right.equals(EMPTY_HASH)) {
        return EMPTY_HASH;
    }
    return sha256Bytes(Buffer.concat([Buffer.from([0x01]), left, right]));
}
function keyIndex64(key) {
    const keyHash = sha256Bytes(Buffer.from(key, 'utf8'));
    return BigInt(`0x${keyHash.subarray(0, 8).toString('hex')}`);
}
function nodeHash(node) {
    return node?.hash ?? EMPTY_HASH;
}
function branch(left, right) {
    if (left === null && right === null) {
        return null;
    }
    return {
        kind: 'branch',
        left,
        right,
        hash: innerHash(nodeHash(left), nodeHash(right)),
    };
}
function updateNode(node, index, key, value, bit) {
    if (bit < 0) {
        if (node !== null && node.kind !== 'leaf') {
            throw new Error(`Invalid Merkle tree shape at leaf for '${key}'`);
        }
        if (node?.kind === 'leaf' && node.key !== key) {
            throw new Error(`Merkle key collision at index ${index.toString()}: '${node.key}' and '${key}'`);
        }
        if (value === null) {
            return null;
        }
        return {
            kind: 'leaf',
            index,
            key,
            value: Buffer.from(value),
            hash: leafHash(key, value),
        };
    }
    if (node !== null && node.kind !== 'branch') {
        throw new Error(`Invalid Merkle tree shape above leaf for '${key}'`);
    }
    const left = node?.kind === 'branch' ? node.left : null;
    const right = node?.kind === 'branch' ? node.right : null;
    if (((index >> BigInt(bit)) & 1n) === 0n) {
        return branch(updateNode(left, index, key, value, bit - 1), right);
    }
    return branch(left, updateNode(right, index, key, value, bit - 1));
}
function findLeaf(node, index) {
    let current = node;
    for (let bit = MERKLE_DEPTH_BITS - 1; bit >= 0; bit -= 1) {
        if (current === null)
            return null;
        if (current.kind !== 'branch') {
            throw new Error('Invalid Merkle tree shape while reading a leaf');
        }
        current = ((index >> BigInt(bit)) & 1n) === 0n
            ? current.left
            : current.right;
    }
    if (current === null)
        return null;
    if (current.kind !== 'leaf') {
        throw new Error('Invalid Merkle tree shape at leaf depth');
    }
    return current;
}
function collectLeaves(node, output) {
    if (node === null)
        return;
    if (node.kind === 'leaf') {
        output.push(node);
        return;
    }
    collectLeaves(node.left, output);
    collectLeaves(node.right, output);
}
/**
 * Immutable-path sparse Merkle tree used by the standalone transaction runtime.
 * Clones share all unchanged nodes, and each update copies only one 64-node path.
 */
class ICS23MerkleTree {
    rootNode = null;
    leafCount = 0;
    clone() {
        const cloned = new ICS23MerkleTree();
        cloned.rootNode = this.rootNode;
        cloned.leafCount = this.leafCount;
        return cloned;
    }
    set(key, value) {
        const valueBuffer = typeof value === 'string' ? Buffer.from(value, 'hex') : Buffer.from(value);
        if (valueBuffer.length === 0) {
            this.delete(key);
            return;
        }
        const index = keyIndex64(key);
        const existing = findLeaf(this.rootNode, index);
        if (existing && existing.key !== key) {
            throw new Error(`Merkle key collision at index ${index.toString()}: '${existing.key}' and '${key}'`);
        }
        this.rootNode = updateNode(this.rootNode, index, key, valueBuffer, MERKLE_DEPTH_BITS - 1);
        if (!existing)
            this.leafCount += 1;
    }
    get(key) {
        const leaf = findLeaf(this.rootNode, keyIndex64(key));
        if (!leaf || leaf.key !== key)
            return undefined;
        return Buffer.from(leaf.value);
    }
    delete(key) {
        const index = keyIndex64(key);
        const existing = findLeaf(this.rootNode, index);
        if (!existing || existing.key !== key)
            return;
        this.rootNode = updateNode(this.rootNode, index, key, null, MERKLE_DEPTH_BITS - 1);
        this.leafCount -= 1;
    }
    size() {
        return this.leafCount;
    }
    getKeys() {
        const leaves = [];
        collectLeaves(this.rootNode, leaves);
        return leaves.map((leaf) => leaf.key);
    }
    getRoot() {
        return nodeHash(this.rootNode).toString('hex');
    }
    getSiblings(key) {
        const index = keyIndex64(key);
        const topDown = [];
        let current = this.rootNode;
        for (let bit = MERKLE_DEPTH_BITS - 1; bit >= 0; bit -= 1) {
            if (current === null) {
                topDown.push(Buffer.from(EMPTY_HASH));
                continue;
            }
            if (current.kind !== 'branch') {
                throw new Error(`Invalid Merkle tree shape while producing siblings for '${key}'`);
            }
            const goesLeft = ((index >> BigInt(bit)) & 1n) === 0n;
            topDown.push(Buffer.from(nodeHash(goesLeft ? current.right : current.left)));
            current = goesLeft ? current.left : current.right;
        }
        return topDown.reverse();
    }
    toJSON() {
        const leaves = {};
        const nodes = [];
        collectLeaves(this.rootNode, nodes);
        for (const node of nodes) {
            leaves[node.key] = node.value.toString('hex');
        }
        return { leaves, root: this.getRoot() };
    }
    static fromJSON(data) {
        const tree = new ICS23MerkleTree();
        for (const [key, value] of Object.entries(data.leaves)) {
            tree.set(key, Buffer.from(value, 'hex'));
        }
        return tree;
    }
}
exports.ICS23MerkleTree = ICS23MerkleTree;
