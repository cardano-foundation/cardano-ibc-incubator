// ICS-23 Compatible Merkle Tree Implementation
//
// This module implements a Simple Merkle Tree (SMT) compatible with ICS-23 specification
// for IBC state proofs. The tree uses:
// - SHA-256 hashing
// - Lexicographic ordering of keys
// - Length-prefixed encoding for keys and values
//
// Reference: https://github.com/cosmos/ibc/tree/main/spec/core/ics-023-vector-commitments

import { sha256 } from 'js-sha256';

/**
 * Represents a node in the Merkle tree
 */
interface MerkleNode {
  key: string;
  value: Buffer;
  hash: Buffer;
  left?: MerkleNode;
  right?: MerkleNode;
}

/**
 * ICS-23 compatible Merkle Tree for IBC state commitments
 */
export class ICS23MerkleTree {
  private leaves: Map<string, Buffer> = new Map();
  private root: Buffer | null = null;
  private dirty: boolean = true;

  constructor() {}

  /**
   * Insert or update a key-value pair in the tree
   * @param key - The key (IBC path like "clients/07-tendermint-0/clientState")
   * @param value - The serialized value (protobuf encoded)
   */
  set(key: string, value: Buffer | string): void {
    const valueBuffer = typeof value === 'string' ? Buffer.from(value, 'hex') : value;
    this.leaves.set(key, valueBuffer);
    this.dirty = true;
  }

  /**
   * Get a value from the tree
   * @param key - The key to retrieve
   * @returns The value buffer or undefined if not found
   */
  get(key: string): Buffer | undefined {
    return this.leaves.get(key);
  }

  /**
   * Delete a key from the tree
   * @param key - The key to delete
   */
  delete(key: string): void {
    this.leaves.delete(key);
    this.dirty = true;
  }

  /**
   * Compute the Merkle root hash of the tree
   * @returns The root hash as a hex string (64 characters for SHA-256)
   */
  getRoot(): string {
    if (!this.dirty && this.root) {
      return this.root.toString('hex');
    }

    if (this.leaves.size === 0) {
      // Empty tree root is 32 bytes of zeros
      this.root = Buffer.alloc(32, 0);
      this.dirty = false;
      return this.root.toString('hex');
    }

    // Build the tree from sorted leaves
    const sortedKeys = Array.from(this.leaves.keys()).sort();
    const leafNodes: MerkleNode[] = sortedKeys.map((key) => ({
      key,
      value: this.leaves.get(key)!,
      hash: this.hashLeaf(key, this.leaves.get(key)!),
    }));

    // Build tree bottom-up
    this.root = this.buildTree(leafNodes);
    this.dirty = false;

    return this.root.toString('hex');
  }

  /**
   * Hash a leaf node according to ICS-23 specification
   * @param key - The key
   * @param value - The value
   * @returns The leaf hash
   */
  private hashLeaf(key: string, value: Buffer): Buffer {
    // ICS-23 leaf hash: hash(length(key) || key || length(value) || value)
    const keyBuffer = Buffer.from(key, 'utf8');
    const keyLength = this.encodeVarint(keyBuffer.length);
    const valueLength = this.encodeVarint(value.length);

    const data = Buffer.concat([keyLength, keyBuffer, valueLength, value]);
    return Buffer.from(sha256.array(data));
  }

  /**
   * Hash an inner node
   * @param left - Left child hash
   * @param right - Right child hash
   * @returns The inner node hash
   */
  private hashInner(left: Buffer, right: Buffer): Buffer {
    // ICS-23 inner hash: hash(0x01 || left || right)
    // The 0x01 prefix distinguishes inner nodes from leaf nodes
    const data = Buffer.concat([Buffer.from([0x01]), left, right]);
    return Buffer.from(sha256.array(data));
  }

  /**
   * Build the Merkle tree from leaf nodes
   * @param nodes - Array of leaf nodes (must be sorted)
   * @returns The root hash
   */
  private buildTree(nodes: MerkleNode[]): Buffer {
    if (nodes.length === 0) {
      return Buffer.alloc(32, 0);
    }

    if (nodes.length === 1) {
      return nodes[0].hash;
    }

    // Build tree level by level
    let currentLevel = nodes.map((node) => node.hash);

    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Pair exists
          nextLevel.push(this.hashInner(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Odd node out - promote it to next level
          nextLevel.push(currentLevel[i]);
        }
      }

      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  /**
   * Encode an integer as varint (protobuf-style)
   * @param value - The integer to encode
   * @returns The varint-encoded buffer
   */
  private encodeVarint(value: number): Buffer {
    const bytes: number[] = [];

    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }

    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
  }

  /**
   * Get all keys in the tree
   * @returns Array of all keys
   */
  getKeys(): string[] {
    return Array.from(this.leaves.keys());
  }

  /**
   * Get the number of entries in the tree
   * @returns The number of key-value pairs
   */
  size(): number {
    return this.leaves.size;
  }

  /**
   * Serialize the tree state to a JSON-compatible object
   * @returns Serialized tree state
   */
  toJSON(): { leaves: Record<string, string>; root: string } {
    const leaves: Record<string, string> = {};
    this.leaves.forEach((value, key) => {
      leaves[key] = value.toString('hex');
    });

    return {
      leaves,
      root: this.getRoot(),
    };
  }

  /**
   * Deserialize tree state from JSON
   * @param data - Serialized tree state
   * @returns New MerkleTree instance
   */
  static fromJSON(data: { leaves: Record<string, string>; root?: string }): ICS23MerkleTree {
    const tree = new ICS23MerkleTree();

    Object.entries(data.leaves).forEach(([key, value]) => {
      tree.set(key, Buffer.from(value, 'hex'));
    });

    return tree;
  }

  /**
   * Clone the tree
   * @returns A new tree with the same state
   */
  clone(): ICS23MerkleTree {
    const newTree = new ICS23MerkleTree();
    this.leaves.forEach((value, key) => {
      newTree.set(key, Buffer.from(value));
    });
    return newTree;
  }
}

