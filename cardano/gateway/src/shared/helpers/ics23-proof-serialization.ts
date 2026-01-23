// ICS-23 Proof Serialization
//
// The Gateway maintains an in-memory Merkle tree whose root is committed on-chain as `ibc_state_root`.
// For queries like ClientState/ConsensusState/Connection/Channel/Packet commitments, we return:
// - the queried value, and
// - a proof that can be verified against `ibc_state_root` on the counterparty chain.
//
// Proof format:
// - We must emit canonical protobuf bytes for `ibc.core.commitment.v1.MerkleProof` so Hermes and
//   standard IBC tooling can carry these proofs unchanged.
// - The Cosmos-side Mithril light client accepts `MerkleProof` bytes and verifies the path according
//   to the Cardano commitment scheme (a fixed-depth binary tree keyed by sha256(key)).
//
// Note: While we use the ICS-23 protobuf container types (`ExistenceProof`, `InnerOp`, ...),
// the verification logic on the counterparty is specific to our commitment scheme, not the generic
// ICS-23 proof specs used by IAVL/SMT in Cosmos SDK chains.

import {
  ICS23ExistenceProof,
  ICS23NonExistenceProof,
} from './ics23-merkle-tree';

import { HashOp } from '@plus/proto-types/build/cosmos/ics23/v1/proofs';
import { MerkleProof } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';

/**
 * Serialize an ICS-23 ExistenceProof to protobuf-compatible MerkleProof bytes
 *
 * @param proof - The ExistenceProof to serialize
 * @returns Buffer containing protobuf-encoded MerkleProof
 */
export function serializeExistenceProof(proof: ICS23ExistenceProof): Buffer {
  const merkleProof: MerkleProof = {
    proofs: [
      {
        exist: {
          key: proof.key,
          value: proof.value,
          // We intentionally omit `leaf`: counterparty verification does not rely on it.
          path: proof.path.map((innerOp) => ({
            hash: HashOp.SHA256,
            prefix: innerOp.prefix,
            suffix: innerOp.suffix,
          })),
        },
      },
    ],
  };

  return Buffer.from(MerkleProof.encode(merkleProof).finish());
}

/**
 * Serialize an ICS-23 NonExistenceProof to protobuf-compatible MerkleProof bytes
 *
 * @param proof - The NonExistenceProof to serialize
 * @returns Buffer containing protobuf-encoded MerkleProof
 */
export function serializeNonExistenceProof(proof: ICS23NonExistenceProof): Buffer {
  const merkleProof: MerkleProof = {
    proofs: [
      {
        nonexist: {
          key: proof.key,
          left: proof.left ? serializeExistenceProofInner(proof.left) : undefined,
          right: proof.right ? serializeExistenceProofInner(proof.right) : undefined,
        },
      },
    ],
  };

  return Buffer.from(MerkleProof.encode(merkleProof).finish());
}

/**
 * Helper to serialize ExistenceProof for embedding in NonExistenceProof
 */
function serializeExistenceProofInner(proof: ICS23ExistenceProof): any {
  return {
    key: proof.key,
    value: proof.value,
    path: proof.path.map((innerOp) => ({
      hash: HashOp.SHA256,
      prefix: innerOp.prefix,
      suffix: innerOp.suffix,
    })),
  };
}
