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

import { Buffer } from 'node:buffer';
import {
  type BucketEntry, MERKLE_DEPTH_BITS, EMPTY_HASH, keyHash, hash,
  innerHash, bucketHash, sortBucket, encodeBucket, needsBucketWitness, witnessLeaf,
} from './ibcStateCommitment.ts';

function keyIndex64(key: string): bigint {
  return keyHash(key).readBigUInt64BE();
}

/**
 * Represents an inner step of a proof.
 *
 * This intentionally mirrors the existing "ICS23InnerOp" shape used in the
 * Gateway codebase and can be serialized into standard protobuf `MerkleProof`
 * bytes for Hermes/Cosmos verification.
 *
 * Convention:
 * - An optional first operation has `prefix = 0x02 || bucket entries` and an empty suffix.
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

  private buckets = new Map<bigint, BucketEntry[]>();
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
   * An occupied collision position prepends its complete bucket descriptor.
   * This is the exact structure we use as an on-chain update witness.
   */
  getSiblings(key: string): Buffer[] {
    this.ensureRebuilt();

    const digest = keyHash(key);
    let index = digest.readBigUInt64BE();
    const bucket = this.buckets.get(index) ?? [];
    const siblings: Buffer[] = needsBucketWitness(bucket, digest) ? [encodeBucket(bucket)] : [];

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

    const path = this.proofPath(key);

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
   * An empty value claims absence of this full key. At an occupied collision
   * position the proof includes the bucket to show that its other keys remain.
   */
  generateNonExistenceProof(key: string): ICS23NonExistenceProof {
    if (this.leaves.has(key)) {
      throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
    }

    if (this.leaves.size === 0) {
      throw new Error(`Cannot generate non-existence proof: tree is empty`);
    }

    const path = this.proofPath(key);

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

    try {
      const key = proof.key.toString('utf8');
      if (!Buffer.from(key, 'utf8').equals(proof.key)) return false;
      const hasBucket = proof.path.length === MERKLE_DEPTH_BITS + 1;
      const operations = hasBucket ? proof.path.slice(1) : proof.path;
      const witness: Buffer[] = [];
      if (hasBucket) {
        const descriptor = proof.path[0];
        if (!descriptor || descriptor.hash !== 1 || descriptor.suffix.length !== 0) return false;
        witness.push(descriptor.prefix);
      }
      if (operations.length !== MERKLE_DEPTH_BITS) return false;
      let index = keyIndex64(key);
      for (const op of operations) {
        if (!op || op.hash !== 1) return false;
        if ((index & 1n) === 0n) {
          if (!op.prefix.equals(Buffer.from([1])) || op.suffix.length !== 32) return false;
          witness.push(op.suffix);
        } else {
          if (op.suffix.length !== 0 || op.prefix.length !== 33 || op.prefix[0] !== 1) return false;
          witness.push(op.prefix.subarray(1));
        }
        index >>= 1n;
      }
      const { leaf, siblings } = witnessLeaf(keyHash(key), proof.value, witness);
      let current = leaf;
      index = keyIndex64(key);
      for (const sibling of siblings) {
        current = (index & 1n) === 0n ? innerHash(current, sibling) : innerHash(sibling, current);
        index >>= 1n;
      }
      return current.equals(this.root);
    } catch {
      return false;
    }
  }

  private proofPath(key: string): ICS23InnerOp[] {
    const witness = this.getSiblings(key);
    const hasBucket = witness.length === MERKLE_DEPTH_BITS + 1;
    const siblings = hasBucket ? witness.slice(1) : witness;
    const path: ICS23InnerOp[] = hasBucket ? [{ hash: 1, prefix: witness[0], suffix: Buffer.alloc(0) }] : [];
    let index = keyIndex64(key);
    for (const sibling of siblings) {
      path.push((index & 1n) === 0n
        ? { hash: 1, prefix: Buffer.from([1]), suffix: sibling }
        : { hash: 1, prefix: Buffer.concat([Buffer.from([1]), sibling]), suffix: Buffer.alloc(0) });
      index >>= 1n;
    }
    return path;
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

    const buckets = new Map<bigint, BucketEntry[]>();
    for (const [key, value] of this.leaves) {
      const digest = keyHash(key);
      const index = digest.readBigUInt64BE();
      const bucket = buckets.get(index) ?? [];
      bucket.push({ keyHash: digest, valueHash: hash(value) });
      buckets.set(index, bucket);
    }
    for (const [index, bucket] of buckets) {
      nodesByHeight[0].set(index, bucketHash(sortBucket(bucket)));
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

    this.buckets = buckets;
    this.nodesByHeight = nodesByHeight;
    this.root = nodesByHeight[MERKLE_DEPTH_BITS].get(0n) ?? EMPTY_HASH;
    this.dirty = false;
  }
}
