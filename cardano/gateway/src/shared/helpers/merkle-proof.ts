import { CommitmentProof, ExistenceProof, MerkleProof, NonExistenceProof } from '../types/isc-23/merkle';
import { MerkleProof as MerkleProofMsg } from '@cosmjs-types/src/ibc/core/commitment/v1/commitment';
import { toHex } from './hex';
import {
  ExistenceProof as ExistenceProofMsg,
  NonExistenceProof as NonExistenceProofMsg,
} from '@cosmjs-types/src/cosmos/ics23/v1/proofs';

export function initializeMerkleProof(merkleProofMsg: MerkleProofMsg): MerkleProof {
  const proofs: CommitmentProof[] = merkleProofMsg.proofs.map((commitmentProof) => {
    if (commitmentProof.exist)
      return {
        proof: {
          CommitmentProof_Exist: { exist: initializeExistenceProof(commitmentProof.exist) },
        },
      };
    if (commitmentProof.nonexist)
      return {
        proof: {
          CommitmentProof_Nonexist: {
            non_exist: initializeNonExistProof(commitmentProof.nonexist),
          },
        },
      };
    if (commitmentProof.batch) return { proof: 'CommitmentProof_Batch' };
    if (commitmentProof.compressed) return { proof: 'CommitmentProof_Compressed' };
  });

  return {
    proofs,
  };
}
export function initializeExistenceProof(existenceProofMsg: ExistenceProofMsg): ExistenceProof {
  return {
    key: toHex(existenceProofMsg?.key),
    value: toHex(existenceProofMsg?.value),
    leaf: {
      hash: BigInt(existenceProofMsg?.leaf?.hash || 0n),
      prehash_key: BigInt(existenceProofMsg?.leaf?.prehash_key || 0n),
      prehash_value: BigInt(existenceProofMsg?.leaf?.prehash_value || 0n),
      length: BigInt(existenceProofMsg?.leaf?.length || 0n),
      prefix: toHex(existenceProofMsg?.leaf?.prefix || 0n),
    },
    path: (existenceProofMsg?.path || []).map((innerOp) => {
      return {
        hash: BigInt(innerOp?.hash || 0n),
        prefix: toHex(innerOp?.prefix),
        suffix: toHex(innerOp?.suffix),
      };
    }),
  };
}
export function initializeNonExistProof(nonExistenceProofMsg: NonExistenceProofMsg): NonExistenceProof {
  return {
    key: toHex(nonExistenceProofMsg?.key),
    left: initializeExistenceProof(nonExistenceProofMsg.left),
    right: initializeExistenceProof(nonExistenceProofMsg.right),
  };
}
