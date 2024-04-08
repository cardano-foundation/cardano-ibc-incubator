export type MerkleProof = {
  proofs: CommitmentProof[];
};

export type CommitmentProof = {
  proof: CommitmentProof_Proof;
};
export type CommitmentProof_Proof =
  | { CommitmentProof_Exist: { exist: ExistenceProof } }
  | { CommitmentProof_Nonexist: { non_exist: NonExistenceProof } }
  | 'CommitmentProof_Batch'
  | 'CommitmentProof_Compressed';

export type ExistenceProof = {
  key: string;
  value: string;
  leaf: LeafOp;
  path: InnerOp[];
};

export type InnerOp = {
  hash: bigint;
  prefix: string;
  suffix: string;
};

export type LeafOp = {
  hash: bigint;
  prehash_key: bigint;
  prehash_value: bigint;
  length: bigint;
  prefix: string;
};

export type NonExistenceProof = {
  key: string;
  left: ExistenceProof;
  right: ExistenceProof;
};
