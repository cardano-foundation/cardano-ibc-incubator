// ICS-23 Compatible Merkle Tree Implementation
//
// This module implements a Merkle tree for generating cryptographic proofs of IBC state.
// 
// Architecture:
// - Only the 32-byte root hash is stored on-chain (in Handler UTXO datum)
// - Gateway maintains the full tree in memory and generates proofs on-demand
// - Proofs are compact (~log₂N sibling hashes) and cryptographically unforgeable
// - Cosmos verifies proofs by reconstructing the root and comparing to certified root
//
// Tree structure:
// - SHA-256 hashing with length-prefix encoding
// - Lexicographic key ordering for determinism
// - Binary tree built bottom-up from sorted leaves
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

  /**
   * Generate an ICS-23 ExistenceProof for a given key
   * 
   * Proof generation walks the tree collecting sibling hashes at each level.
   * These siblings let the verifier reconstruct the root via repeated hashing:
   * 
   *   leafHash = hash(key || value)
   *   level1 = hash(prefix || leafHash || sibling₁)
   *   level2 = hash(prefix || level1 || sibling₂)
   *   ... until root
   * 
   * Security: Proofs are unforgeable because they require the exact sibling hashes
   * from the real tree. Faking data breaks the hash chain (unless you break SHA-256).
   * 
   * @param key - The IBC path key (e.g., "clients/07-tendermint-0/clientState")
   * @returns ExistenceProof object containing key, value, leaf spec, and inner path
   * @throws Error if the key doesn't exist in the tree
   */
  generateProof(key: string): ICS23ExistenceProof {
    // 1. Verify key exists
    const value = this.leaves.get(key);
    if (!value) {
      throw new Error(`Cannot generate proof: key '${key}' not found in tree`);
    }

    if (this.leaves.size === 0) {
      throw new Error(`Cannot generate proof: tree is empty`);
    }

    // 2. Build sorted leaf array (same as getRoot())
    const sortedKeys = Array.from(this.leaves.keys()).sort();
    
    // Find the index of our key
    const keyIndex = sortedKeys.indexOf(key);
    if (keyIndex === -1) {
      throw new Error(`Key '${key}' not found in sorted leaves`);
    }

    // 3. Build leaf nodes
    const leafNodes: MerkleNode[] = sortedKeys.map((k) => ({
      key: k,
      value: this.leaves.get(k)!,
      hash: this.hashLeaf(k, this.leaves.get(k)!),
    }));

    // Special case: single leaf tree
    if (leafNodes.length === 1) {
      return {
        key: Buffer.from(key, 'utf8'),
        value: value,
        leaf: {
          hash: 1, // HashOp.SHA256
          prehash_key: 0, // HashOp.NO_HASH
          prehash_value: 0, // HashOp.NO_HASH
          length: 1, // LengthOp.VAR_PROTO
          prefix: Buffer.alloc(0), // No prefix for leaf nodes
        },
        path: [], // No inner nodes for single leaf
      };
    }

    // 4. Build tree level by level, tracking our key's path
    let currentLevel = leafNodes.map((node) => node.hash);
    let currentIndex = keyIndex;
    const innerOps: ICS23InnerOp[] = [];

    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];
      const nextIndex = Math.floor(currentIndex / 2);

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Pair exists - create inner node
          const left = currentLevel[i];
          const right = currentLevel[i + 1];
          nextLevel.push(this.hashInner(left, right));

          // If this pair contains our node, record the sibling
          if (i === currentIndex || i + 1 === currentIndex) {
            const isLeftChild = (currentIndex % 2 === 0);
            
            if (isLeftChild) {
              // Our node is the left child, sibling is on the right
              innerOps.push({
                hash: 1, // HashOp.SHA256
                prefix: Buffer.from([0x01]), // Inner node prefix
                suffix: right, // Right sibling hash
              });
            } else {
              // Our node is the right child, sibling is on the left
              innerOps.push({
                hash: 1, // HashOp.SHA256
                prefix: Buffer.concat([Buffer.from([0x01]), left]), // Prefix includes left sibling
                suffix: Buffer.alloc(0), // No suffix
              });
            }
          }
        } else {
          // Odd node out - promote to next level
          nextLevel.push(currentLevel[i]);
          
          // If this is our node being promoted, no sibling at this level
          if (i === currentIndex) {
            // Node promoted without pairing - this is handled implicitly
            // The next level index calculation will work correctly
          }
        }
      }

      currentLevel = nextLevel;
      currentIndex = nextIndex;
    }

    // 5. Return the ExistenceProof
    return {
      key: Buffer.from(key, 'utf8'),
      value: value,
      leaf: {
        hash: 1, // HashOp.SHA256
        prehash_key: 0, // HashOp.NO_HASH
        prehash_value: 0, // HashOp.NO_HASH
        length: 1, // LengthOp.VAR_PROTO
        prefix: Buffer.alloc(0), // No prefix for leaf nodes in our spec
      },
      path: innerOps,
    };
  }

  /**
   * Generate an ICS-23 NonExistenceProof for a key that doesn't exist
   * 
   * A non-existence proof demonstrates that a key is not present in the tree
   * by providing existence proofs for the closest left and right neighbors.
   * If both neighbors are valid and adjacent, the absence of the key is proven.
   * 
   * @param key - The key to prove non-existence for
   * @returns NonExistenceProof with left and right neighbor proofs
   * @throws Error if the key exists, or if neighbors can't be found
   */
  generateNonExistenceProof(key: string): ICS23NonExistenceProof {
    // 1. Verify key doesn't exist
    if (this.leaves.has(key)) {
      throw new Error(`Cannot generate non-existence proof: key '${key}' exists in tree`);
    }

    if (this.leaves.size === 0) {
      throw new Error(`Cannot generate non-existence proof: tree is empty`);
    }

    // 2. Find left and right neighbors
    const sortedKeys = Array.from(this.leaves.keys()).sort();
    
    let leftKey: string | null = null;
    let rightKey: string | null = null;

    for (let i = 0; i < sortedKeys.length; i++) {
      if (sortedKeys[i] < key) {
        leftKey = sortedKeys[i];
      } else if (sortedKeys[i] > key && rightKey === null) {
        rightKey = sortedKeys[i];
        break;
      }
    }

    // 3. Verify we have both neighbors (or handle edge cases)
    if (!leftKey && !rightKey) {
      throw new Error(`Cannot generate non-existence proof: no neighbors found for key '${key}'`);
    }

    // 4. Generate existence proofs for neighbors
    const leftProof = leftKey ? this.generateProof(leftKey) : null;
    const rightProof = rightKey ? this.generateProof(rightKey) : null;

    return {
      key: Buffer.from(key, 'utf8'),
      left: leftProof,
      right: rightProof,
    };
  }

  /**
   * Verify a proof against this tree's root
   * 
   * This is primarily for testing - reconstructs the root from the proof
   * and compares it to this tree's computed root.
   * 
   * @param proof - The ExistenceProof to verify
   * @returns true if proof is valid for this tree
   */
  verifyProof(proof: ICS23ExistenceProof): boolean {
    // 1. Start with leaf hash
    const keyBuffer = proof.key;
    const valueBuffer = proof.value;
    
    const keyLength = this.encodeVarint(keyBuffer.length);
    const valueLength = this.encodeVarint(valueBuffer.length);
    const leafData = Buffer.concat([keyLength, keyBuffer, valueLength, valueBuffer]);
    let currentHash = Buffer.from(sha256.array(leafData));

    // 2. Apply each InnerOp to reconstruct the root
    for (const innerOp of proof.path) {
      if (innerOp.suffix.length > 0) {
        // Suffix is the sibling - we are the left child
        const data = Buffer.concat([innerOp.prefix, currentHash, innerOp.suffix]);
        currentHash = Buffer.from(sha256.array(data));
      } else {
        // Prefix contains sibling - we are the right child
        // Prefix format: 0x01 || leftSiblingHash
        const data = Buffer.concat([innerOp.prefix, currentHash]);
        currentHash = Buffer.from(sha256.array(data));
      }
    }

    // 3. Compare reconstructed root with tree root
    const expectedRoot = this.getRoot();
    return currentHash.toString('hex') === expectedRoot;
  }
}

/**
 * ICS-23 proof type definitions
 */

export interface ICS23LeafOp {
  hash: number; // HashOp enum value
  prehash_key: number; // HashOp enum value
  prehash_value: number; // HashOp enum value
  length: number; // LengthOp enum value
  prefix: Buffer;
}

export interface ICS23InnerOp {
  hash: number; // HashOp enum value
  prefix: Buffer;
  suffix: Buffer;
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

