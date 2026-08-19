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

import { sha256 } from 'js-sha256';

const MERKLE_DEPTH_BITS = 64;
const HASH_SIZE_BYTES = 32;
const EMPTY_HASH = Buffer.alloc(HASH_SIZE_BYTES, 0);

type LeafNode = {
  kind: 'leaf';
  index: bigint;
  key: string;
  value: Buffer;
  hash: Buffer;
};

type BranchNode = {
  kind: 'branch';
  left: MerkleNode;
  right: MerkleNode;
  hash: Buffer;
};

type MerkleNode = LeafNode | BranchNode | null;

function sha256Bytes(data: Buffer): Buffer {
  return Buffer.from(sha256.array(data));
}

function keyHash(key: string): Buffer {
  return sha256Bytes(Buffer.from(key, 'utf8'));
}

function leafHash(key: string, value: Buffer): Buffer {
  // On-chain we treat the empty value as "absent" and map it to the all-zero hash.
  if (value.length === 0) return EMPTY_HASH;

  // leaf = sha256(0x00 || sha256(key) || sha256(value))
  const valueHash = sha256Bytes(value);
  return sha256Bytes(Buffer.concat([Buffer.from([0x00]), keyHash(key), valueHash]));
}

function innerHash(left: Buffer, right: Buffer): Buffer {
  // Empty subtree compression: if both children are empty, parent is empty.
  if (left.equals(EMPTY_HASH) && right.equals(EMPTY_HASH)) return EMPTY_HASH;
  // inner = sha256(0x01 || left || right)
  return sha256Bytes(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function keyIndex64(key: string): bigint {
  // The on-chain code uses the first 64 bits of `sha256(key)` to define the path.
  // We interpret those 8 bytes as a big-endian unsigned integer.
  const first8 = keyHash(key).subarray(0, 8);
  return BigInt(`0x${first8.toString('hex')}`);
}

function nodeHash(node: MerkleNode): Buffer {
  return node?.hash ?? EMPTY_HASH;
}

function branch(left: MerkleNode, right: MerkleNode): MerkleNode {
  if (left === null && right === null) return null;
  return {
    kind: 'branch',
    left,
    right,
    hash: innerHash(nodeHash(left), nodeHash(right)),
  };
}

function updateNode(node: MerkleNode, index: bigint, key: string, value: Buffer | null, bit: number): MerkleNode {
  if (bit < 0) {
    if (node !== null && node.kind !== 'leaf') {
      throw new Error(`Invalid Merkle tree shape at leaf for '${key}'`);
    }
    if (node?.kind === 'leaf' && node.key !== key) {
      throw new Error(`Merkle key collision at index ${index.toString()}: '${node.key}' and '${key}'`);
    }
    return value === null ? null : { kind: 'leaf', index, key, value: Buffer.from(value), hash: leafHash(key, value) };
  }

  if (node !== null && node.kind !== 'branch') {
    throw new Error(`Invalid Merkle tree shape above leaf for '${key}'`);
  }
  const left = node?.kind === 'branch' ? node.left : null;
  const right = node?.kind === 'branch' ? node.right : null;
  return ((index >> BigInt(bit)) & 1n) === 0n
    ? branch(updateNode(left, index, key, value, bit - 1), right)
    : branch(left, updateNode(right, index, key, value, bit - 1));
}

function findLeaf(node: MerkleNode, index: bigint): LeafNode | null {
  let current = node;
  for (let bit = MERKLE_DEPTH_BITS - 1; bit >= 0; bit -= 1) {
    if (current === null) return null;
    if (current.kind !== 'branch') throw new Error('Invalid Merkle tree shape while reading a leaf');
    current = ((index >> BigInt(bit)) & 1n) === 0n ? current.left : current.right;
  }
  if (current === null) return null;
  if (current.kind !== 'leaf') throw new Error('Invalid Merkle tree shape at leaf depth');
  return current;
}

function collectLeaves(node: MerkleNode, output: LeafNode[]): void {
  if (node === null) return;
  if (node.kind === 'leaf') {
    output.push(node);
    return;
  }
  collectLeaves(node.left, output);
  collectLeaves(node.right, output);
}

/**
 * Represents an inner step of a proof.
 *
 * This intentionally mirrors the existing "ICS23InnerOp" shape used in the
 * Gateway codebase and can be serialized into standard protobuf `MerkleProof`
 * bytes for Hermes/Cosmos verification.
 *
 * Convention:
 * - If `suffix` is non-empty, the current node is the LEFT child and `suffix` is the sibling hash.
 * - If `suffix` is empty, the current node is the RIGHT child and `prefix` contains `0x01 || leftSiblingHash`.
 */
export interface ICS23InnerOp {
  hash: number;
  prefix: Buffer;
  suffix: Buffer;
}

export interface ICS23LeafOp {
  hash: number;
  prehash_key: number;
  prehash_value: number;
  length: number;
  prefix: Buffer;
}

export interface ICS23ExistenceProof {
  key: Buffer;
  value: Buffer;
  leaf: ICS23LeafOp;
  path: ICS23InnerOp[];
}

export interface ICS23NonExistenceProof {
  key: Buffer;
  left: ICS23ExistenceProof | null;
  right: ICS23ExistenceProof | null;
}

/**
 * Fixed-depth Merkle tree keyed by `sha256(key)`.
 */
export class ICS23MerkleTree {
  private rootNode: MerkleNode = null;
  private leafCount = 0;
  private mutationOldValues = new Map<string, string | null>();

  clone(): ICS23MerkleTree {
    const cloned = new ICS23MerkleTree();
    cloned.rootNode = this.rootNode;
    cloned.leafCount = this.leafCount;
    return cloned;
  }

  set(key: string, value: Buffer | string): void {
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
    if (!this.mutationOldValues.has(key)) {
      this.mutationOldValues.set(key, existing?.value.toString('hex') ?? null);
    }
    this.rootNode = updateNode(this.rootNode, index, key, valueBuffer, MERKLE_DEPTH_BITS - 1);
    if (!existing) this.leafCount += 1;
  }

  get(key: string): Buffer | undefined {
    const leaf = findLeaf(this.rootNode, keyIndex64(key));
    return !leaf || leaf.key !== key ? undefined : Buffer.from(leaf.value);
  }

  delete(key: string): void {
    const index = keyIndex64(key);
    const existing = findLeaf(this.rootNode, index);
    if (!existing || existing.key !== key) return;
    if (!this.mutationOldValues.has(key)) {
      this.mutationOldValues.set(key, existing.value.toString('hex'));
    }
    this.rootNode = updateNode(this.rootNode, index, key, null, MERKLE_DEPTH_BITS - 1);
    this.leafCount -= 1;
  }

  size(): number {
    return this.leafCount;
  }

  getKeys(): string[] {
    const leaves: LeafNode[] = [];
    collectLeaves(this.rootNode, leaves);
    return leaves.map((leaf) => leaf.key);
  }

  getRoot(): string {
    return nodeHash(this.rootNode).toString('hex');
  }

  getChanges(): Array<{ path: string; oldValue: string | null; newValue: string | null }> {
    return [...this.mutationOldValues.entries()]
      .map(([path, oldValue]) => ({
        path,
        oldValue,
        newValue: this.get(path)?.toString('hex') ?? null,
      }))
      .filter((change) => change.oldValue !== change.newValue)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  /**
   * Return the per-level sibling hashes for this key, even if the key is not present.
   *
   * This is the exact structure we use as an on-chain update witness.
   */
  getSiblings(key: string): Buffer[] {
    const index = keyIndex64(key);
    const topDown: Buffer[] = [];
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

  /**
   * Generate a membership proof for an existing key.
   */
  generateProof(key: string): ICS23ExistenceProof {
    if (this.leafCount === 0) {
      throw new Error(`Cannot generate proof: tree is empty`);
    }

    const value = this.get(key);
    if (!value) {
      throw new Error(`Cannot generate proof: key '${key}' not found in tree`);
    }

    const siblings = this.getSiblings(key);
    const path: ICS23InnerOp[] = [];

    let index = keyIndex64(key);
    for (const siblingHash of siblings) {
      const isLeftChild = (index & 1n) === 0n;

      if (isLeftChild) {
        path.push({
          hash: 1, // SHA-256
          prefix: Buffer.from([0x01]),
          suffix: siblingHash,
        });
      } else {
        path.push({
          hash: 1, // SHA-256
          prefix: Buffer.concat([Buffer.from([0x01]), siblingHash]),
          suffix: Buffer.alloc(0),
        });
      }

      index >>= 1n;
    }

    return {
      key: Buffer.from(key, 'utf8'),
      value,
      // These fields are carried through for compatibility and potential future
      // tooling. Our current verification logic does not rely on them.
      leaf: {
        hash: 1,
        prehash_key: 0,
        prehash_value: 0,
        length: 0,
        prefix: Buffer.alloc(0),
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
  generateNonExistenceProof(key: string): ICS23NonExistenceProof {
    if (this.get(key)) {
      throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
    }

    if (this.leafCount === 0) {
      throw new Error(`Cannot generate non-existence proof: tree is empty`);
    }

    const siblings = this.getSiblings(key);
    const path: ICS23InnerOp[] = [];

    let index = keyIndex64(key);
    for (const siblingHash of siblings) {
      const isLeftChild = (index & 1n) === 0n;

      if (isLeftChild) {
        path.push({
          hash: 1,
          prefix: Buffer.from([0x01]),
          suffix: siblingHash,
        });
      } else {
        path.push({
          hash: 1,
          prefix: Buffer.concat([Buffer.from([0x01]), siblingHash]),
          suffix: Buffer.alloc(0),
        });
      }

      index >>= 1n;
    }

    const emptyValueProof: ICS23ExistenceProof = {
      key: Buffer.from(key, 'utf8'),
      value: Buffer.alloc(0),
      leaf: {
        hash: 1,
        prehash_key: 0,
        prehash_value: 0,
        length: 0,
        prefix: Buffer.alloc(0),
      },
      path,
    };

    return {
      key: Buffer.from(key, 'utf8'),
      left: emptyValueProof,
      right: null,
    };
  }

  /**
   * Verify a proof against the current tree root.
   *
   * This is primarily used by unit tests to sanity-check the proof generator.
   */
  verifyProof(proof: ICS23ExistenceProof): boolean {
    const proofKey = proof.key.toString('utf8');
    let currentHash = leafHash(proofKey, proof.value);

    for (const op of proof.path) {
      if (op.suffix.length > 0) {
        const left = currentHash;
        const right = op.suffix;
        currentHash = innerHash(left, right);
      } else {
        // prefix format: 0x01 || leftSiblingHash
        const leftSibling = op.prefix.subarray(1);
        const left = leftSibling;
        const right = currentHash;
        currentHash = innerHash(left, right);
      }
    }

    return currentHash.equals(nodeHash(this.rootNode));
  }

  toJSON(): { leaves: Record<string, string>; root: string } {
    const leaves: Record<string, string> = {};
    const nodes: LeafNode[] = [];
    collectLeaves(this.rootNode, nodes);
    for (const node of nodes) leaves[node.key] = node.value.toString('hex');
    return { leaves, root: this.getRoot() };
  }

  static fromJSON(data: { leaves: Record<string, string>; root?: string }): ICS23MerkleTree {
    const tree = new ICS23MerkleTree();
    for (const [key, value] of Object.entries(data.leaves)) {
      tree.set(key, Buffer.from(value, 'hex'));
    }
    return tree;
  }
}
