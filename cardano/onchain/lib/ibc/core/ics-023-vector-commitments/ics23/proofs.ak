use ibc/core/ics_023_vector_commitments/ics23/constants.{
  hash_op_no_hash, hash_op_sha256, length_op_var_proto,
}

pub type ProofSpec {
  leaf_spec: LeafOp,
  inner_spec: InnerSpec,
  max_depth: Int,
  min_depth: Int,
  prehash_key_before_comparison: Bool,
}

pub type InnerSpec {
  child_order: List<Int>,
  child_size: Int,
  min_prefix_length: Int,
  max_prefix_length: Int,
  empty_child: ByteArray,
  hash: HashOp,
}

pub type LeafOp {
  hash: HashOp,
  prehash_key: HashOp,
  prehash_value: HashOp,
  length: LengthOp,
  prefix: ByteArray,
}

pub type HashOp =
  Int

pub type LengthOp =
  Int

pub type InnerOp {
  hash: HashOp,
  prefix: ByteArray,
  suffix: ByteArray,
}

pub type ExistenceProof {
  key: ByteArray,
  value: ByteArray,
  leaf: LeafOp,
  path: List<InnerOp>,
}

pub type NonExistenceProof {
  key: ByteArray,
  left: ExistenceProof,
  right: ExistenceProof,
}

pub type CommitmentProof_Proof {
  CommitmentProof_Exist { exist: ExistenceProof }
  CommitmentProof_Nonexist { non_exist: NonExistenceProof }
  CommitmentProof_Batch
  CommitmentProof_Compressed
}

pub type CommitmentProof {
  proof: CommitmentProof_Proof,
}

pub type CommitmentRoot =
  ByteArray

pub fn get_prefix_leaf_op(m: LeafOp) -> ByteArray {
  m.prefix
}

pub fn get_prefix_inner_op(m: InnerOp) -> ByteArray {
  m.prefix
}

pub fn null_leaf_op() -> LeafOp {
  LeafOp { hash: 0, prehash_key: 0, prehash_value: 0, length: 0, prefix: "" }
}

pub fn null_inner_op() -> InnerOp {
  InnerOp { hash: 0, prefix: #[], suffix: #[] }
}

pub fn null_existance_proof() -> ExistenceProof {
  ExistenceProof { key: #[], value: #[], leaf: null_leaf_op(), path: [] }
}

pub fn null_non_existance_proof() -> NonExistenceProof {
  NonExistenceProof {
    key: #[],
    left: null_existance_proof(),
    right: null_existance_proof(),
  }
}

pub fn null_commitment_proof() -> CommitmentProof {
  CommitmentProof {
    proof: CommitmentProof_Exist { exist: null_existance_proof() },
  }
}

/// null_inner_spec() constructs a null inner spec
pub fn null_inner_spec() -> InnerSpec {
  InnerSpec {
    child_order: [],
    child_size: 0,
    min_prefix_length: 0,
    max_prefix_length: 0,
    empty_child: "",
    hash: 0,
  }
}

/// null_proof_spec() constructs a null proof spec
pub fn null_proof_spec() -> ProofSpec {
  let null_leaf_op =
    LeafOp { hash: 0, prehash_key: 0, prehash_value: 0, length: 0, prefix: "" }
  let null_inner_spec =
    InnerSpec {
      child_order: [],
      child_size: 0,
      min_prefix_length: 0,
      max_prefix_length: 0,
      empty_child: "",
      hash: 0,
    }
  ProofSpec {
    leaf_spec: null_leaf_op,
    inner_spec: null_inner_spec,
    max_depth: 0,
    min_depth: 0,
    prehash_key_before_comparison: False,
  }
}

/// iavl_spec() constructs a iavl spec that constrains the format from proofs-iavl (iavl merkle proofs)
pub fn iavl_spec() -> ProofSpec {
  ProofSpec {
    leaf_spec: LeafOp {
      hash: hash_op_sha256,
      prehash_key: hash_op_no_hash,
      prehash_value: hash_op_sha256,
      length: length_op_var_proto,
      prefix: #[0],
    },
    inner_spec: InnerSpec {
      child_order: [0, 1],
      min_prefix_length: 4,
      max_prefix_length: 12,
      child_size: 33,
      empty_child: #[],
      hash: hash_op_sha256,
    },
    max_depth: 0,
    min_depth: 0,
    prehash_key_before_comparison: False,
  }
}

/// tendermint_spec() constructs a tendermint spec that constrains the format from proofs-tendermint (crypto/merkle SimpleProof)
pub fn tendermint_spec() -> ProofSpec {
  ProofSpec {
    leaf_spec: LeafOp {
      hash: hash_op_sha256,
      prehash_key: hash_op_no_hash,
      prehash_value: hash_op_sha256,
      length: length_op_var_proto,
      prefix: #[0],
    },
    inner_spec: InnerSpec {
      child_order: [0, 1],
      min_prefix_length: 1,
      max_prefix_length: 1,
      child_size: 32,
      empty_child: #[],
      hash: hash_op_sha256,
    },
    max_depth: 0,
    min_depth: 0,
    prehash_key_before_comparison: False,
  }
}

//TODO: Need to implement over-declares equality
pub fn spec_equals(p: ProofSpec, spec: ProofSpec) -> Bool {
  p == spec
}
