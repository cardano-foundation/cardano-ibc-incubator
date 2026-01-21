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

function sha256Bytes(data: Buffer): Buffer {
  return Buffer.from(sha256.array(data));
}

function leafHash(value: Buffer): Buffer {
  // On-chain we treat the empty value as "absent" and map it to the all-zero hash.
  if (value.length === 0) return EMPTY_HASH;

  // leaf = sha256(0x00 || sha256(value))
  const valueHash = sha256Bytes(value);
  return sha256Bytes(Buffer.concat([Buffer.from([0x00]), valueHash]));
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
  const keyHash = sha256Bytes(Buffer.from(key, 'utf8'));
  const first8 = keyHash.subarray(0, 8);
  return BigInt(`0x${first8.toString('hex')}`);
}

/**
 * Represents an inner step of a proof.
 *
 * This intentionally mirrors the existing "ICS23InnerOp" shape used in the
 * Gateway codebase, even though the current proof encoding is JSON.
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
  private leaves: Map<string, Buffer> = new Map();

  private root: Buffer = EMPTY_HASH;
  private dirty = true;
  private nodesByHeight: Array<Map<bigint, Buffer>> | null = null;

  clone(): ICS23MerkleTree {
    const cloned = new ICS23MerkleTree();
    for (const [key, value] of this.leaves) {
      cloned.leaves.set(key, Buffer.from(value));
    }
    cloned.dirty = true;
    return cloned;
  }

  set(key: string, value: Buffer | string): void {
    const valueBuffer = typeof value === 'string' ? Buffer.from(value, 'hex') : value;
    // Empty values are treated as "absent" in this commitment scheme, so we
    // model them as deletion to avoid ambiguous state.
    if (valueBuffer.length === 0) {
      this.leaves.delete(key);
    } else {
      this.leaves.set(key, valueBuffer);
    }
    this.dirty = true;
  }

  get(key: string): Buffer | undefined {
    return this.leaves.get(key);
  }

  delete(key: string): void {
    this.leaves.delete(key);
    this.dirty = true;
  }

  size(): number {
    return this.leaves.size;
  }

  getKeys(): string[] {
    return Array.from(this.leaves.keys());
  }

  getRoot(): string {
    this.ensureRebuilt();
    return this.root.toString('hex');
  }

  /**
   * Return the per-level sibling hashes for this key, even if the key is not present.
   *
   * This is the exact structure we use as an on-chain update witness.
   */
  getSiblings(key: string): Buffer[] {
    this.ensureRebuilt();

    const siblings: Buffer[] = [];
    let index = keyIndex64(key);

    for (let height = 0; height < MERKLE_DEPTH_BITS; height++) {
      const siblingIndex = index ^ 1n;
      const siblingHash = this.nodesByHeight![height].get(siblingIndex) ?? EMPTY_HASH;
      siblings.push(Buffer.from(siblingHash));
      index >>= 1n;
    }

    return siblings;
  }

  /**
   * Generate a membership proof for an existing key.
   */
  generateProof(key: string): ICS23ExistenceProof {
    if (this.leaves.size === 0) {
      throw new Error(`Cannot generate proof: tree is empty`);
    }

    const value = this.leaves.get(key);
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
      // These fields are currently carried through as metadata for JSON proof serialization.
      // The verification logic below does not rely on them.
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
    if (this.leaves.has(key)) {
      throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
    }

    if (this.leaves.size === 0) {
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
    this.ensureRebuilt();

    // Leaf hash is based on the value only (the key influences the path, not the leaf digest).
    let currentHash = leafHash(proof.value);

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

    return currentHash.equals(this.root);
  }

  toJSON(): { leaves: Record<string, string>; root: string } {
    const leaves: Record<string, string> = {};
    this.leaves.forEach((value, key) => {
      leaves[key] = value.toString('hex');
    });
    return { leaves, root: this.getRoot() };
  }

  static fromJSON(data: { leaves: Record<string, string>; root?: string }): ICS23MerkleTree {
    const tree = new ICS23MerkleTree();
    for (const [key, value] of Object.entries(data.leaves)) {
      tree.set(key, Buffer.from(value, 'hex'));
    }
    return tree;
  }

  private ensureRebuilt(): void {
    if (!this.dirty && this.nodesByHeight) return;

    const nodesByHeight: Array<Map<bigint, Buffer>> = Array.from(
      { length: MERKLE_DEPTH_BITS + 1 },
      () => new Map<bigint, Buffer>(),
    );

    const indexToKey = new Map<bigint, string>();
    for (const [key, value] of this.leaves) {
      const index = keyIndex64(key);

      const previousKey = indexToKey.get(index);
      if (previousKey && previousKey !== key) {
        throw new Error(
          `Merkle key collision at index ${index.toString()}: '${previousKey}' and '${key}'`,
        );
      }
      indexToKey.set(index, key);

      const h = leafHash(value);
      if (!h.equals(EMPTY_HASH)) nodesByHeight[0].set(index, h);
    }

    for (let height = 1; height <= MERKLE_DEPTH_BITS; height++) {
      const childMap = nodesByHeight[height - 1];
      const parentMap = nodesByHeight[height];

      const parents = new Set<bigint>();
      for (const childIndex of childMap.keys()) {
        parents.add(childIndex >> 1n);
      }

      for (const parentIndex of parents) {
        const leftIndex = parentIndex << 1n;
        const rightIndex = leftIndex + 1n;

        const left = childMap.get(leftIndex) ?? EMPTY_HASH;
        const right = childMap.get(rightIndex) ?? EMPTY_HASH;

        const p = innerHash(left, right);
        if (!p.equals(EMPTY_HASH)) parentMap.set(parentIndex, p);
      }
    }

    this.nodesByHeight = nodesByHeight;
    this.root = nodesByHeight[MERKLE_DEPTH_BITS].get(0n) ?? EMPTY_HASH;
    this.dirty = false;
  }
}
