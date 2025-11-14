// ICS-23 Proof Serialization
//
// ICS-23 proofs are compact cryptographic recipes that let anyone verify data exists in a Merkle tree.
// 
// How it works:
// 1. Gateway generates proof = { key, value, sibling_hashes[] }
// 2. Hermes relays proof to Cosmos
// 3. Cosmos reconstructs root: hash(leaf + sibling₁ + sibling₂ + ...) 
// 4. If reconstructed root == certified root → data is authentic 
//
// Security: Even a malicious Gateway cannot forge valid proofs (would require breaking SHA-256).
// The proof is unforgeable because changing any data breaks the hash chain.

import {
  ICS23ExistenceProof,
  ICS23NonExistenceProof,
  ICS23LeafOp,
  ICS23InnerOp,
} from './ics23-merkle-tree';

/**
 * Serialize an ICS-23 ExistenceProof to protobuf-compatible MerkleProof bytes
 * 
 * The IBC MerkleProof format wraps the ExistenceProof in a CommitmentProof message:
 * MerkleProof {
 *   proofs: [CommitmentProof{ exist: ExistenceProof }]
 * }
 * 
 * For now, this returns a JSON representation. In production, this should use
 * the @plus/proto-types compiled protobuf library to properly encode.
 * 
 * TODO: Replace with actual protobuf encoding using @plus/proto-types
 * 
 * @param proof - The ExistenceProof to serialize
 * @returns Buffer containing protobuf-encoded MerkleProof
 */
export function serializeExistenceProof(proof: ICS23ExistenceProof): Buffer {
  // For now, return JSON-encoded proof
  // This is sufficient for testing and demonstration
  // Production implementation should use protobufjs or @plus/proto-types
  
  const merkleProof = {
    proofs: [
      {
        exist: {
          key: proof.key.toString('hex'),
          value: proof.value.toString('hex'),
          leaf: {
            hash: proof.leaf.hash,
            prehash_key: proof.leaf.prehash_key,
            prehash_value: proof.leaf.prehash_value,
            length: proof.leaf.length,
            prefix: proof.leaf.prefix.toString('hex'),
          },
          path: proof.path.map((innerOp) => ({
            hash: innerOp.hash,
            prefix: innerOp.prefix.toString('hex'),
            suffix: innerOp.suffix.toString('hex'),
          })),
        },
      },
    ],
  };

  return Buffer.from(JSON.stringify(merkleProof), 'utf8');
}

/**
 * Serialize an ICS-23 NonExistenceProof to protobuf-compatible MerkleProof bytes
 * 
 * @param proof - The NonExistenceProof to serialize
 * @returns Buffer containing protobuf-encoded MerkleProof
 */
export function serializeNonExistenceProof(proof: ICS23NonExistenceProof): Buffer {
  const merkleProof = {
    proofs: [
      {
        nonexist: {
          key: proof.key.toString('hex'),
          left: proof.left ? serializeExistenceProofInner(proof.left) : null,
          right: proof.right ? serializeExistenceProofInner(proof.right) : null,
        },
      },
    ],
  };

  return Buffer.from(JSON.stringify(merkleProof), 'utf8');
}

/**
 * Helper to serialize ExistenceProof for embedding in NonExistenceProof
 */
function serializeExistenceProofInner(proof: ICS23ExistenceProof): any {
  return {
    key: proof.key.toString('hex'),
    value: proof.value.toString('hex'),
    leaf: {
      hash: proof.leaf.hash,
      prehash_key: proof.leaf.prehash_key,
      prehash_value: proof.leaf.prehash_value,
      length: proof.leaf.length,
      prefix: proof.leaf.prefix.toString('hex'),
    },
    path: proof.path.map((innerOp) => ({
      hash: innerOp.hash,
      prefix: innerOp.prefix.toString('hex'),
      suffix: innerOp.suffix.toString('hex'),
    })),
  };
}

/**
 * Placeholder for future protobuf encoding using @plus/proto-types
 * 
 * When implemented, this will properly encode using the compiled protobuf definitions:
 * 
 * import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
 * 
 * export function serializeExistenceProofProtobuf(proof: ICS23ExistenceProof): Buffer {
 *   const merkleProof = MerkleProof.fromPartial({
 *     proofs: [{
 *       exist: {
 *         key: proof.key,
 *         value: proof.value,
 *         leaf: proof.leaf,
 *         path: proof.path,
 *       }
 *     }]
 *   });
 *   
 *   return Buffer.from(MerkleProof.encode(merkleProof).finish());
 * }
 */

