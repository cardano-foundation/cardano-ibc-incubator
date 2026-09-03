import { CommitmentProof, ExistenceProof, MerkleProof, NonExistenceProof } from '../types/isc-23/merkle';
import { MerkleProof as MerkleProofMsg } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { toHex } from './hex';
import {
  ExistenceProof as ExistenceProofMsg,
  NonExistenceProof as NonExistenceProofMsg,
} from '@cardano-ibc/proto-types/build/cosmos/ics23/v1/proofs';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

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
    throw new GrpcInvalidArgumentException('Commitment proof does not contain a supported proof variant');
  });

  return {
    proofs,
  };
}
export function initializeExistenceProof(existenceProofMsg?: ExistenceProofMsg): ExistenceProof {
  const leaf = existenceProofMsg?.leaf;
  return {
    key: toHex(existenceProofMsg?.key),
    value: toHex(existenceProofMsg?.value),
    leaf: {
      hash: BigInt(leaf?.hash ?? 0),
      prehash_key: BigInt(leaf?.prehash_key ?? 0),
      prehash_value: BigInt(leaf?.prehash_value ?? 0),
      length: BigInt(leaf?.length ?? 0),
      prefix: toHex(leaf?.prefix),
    },
    path: (existenceProofMsg?.path ?? []).map((innerOp) => {
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
    key: toHex(nonExistenceProofMsg.key),
    left: initializeExistenceProof(nonExistenceProofMsg.left),
    right: initializeExistenceProof(nonExistenceProofMsg.right),
  };
}
