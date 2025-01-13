pub type ProofSpec {
  leaf_spec: LeafOp,
  inner_spec: InnerSpec,
  max_depth: Int,
  min_depth: Int,
  prehash_key_before_comparison: Bool,
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

pub type InnerSpec {
  child_order: List<Int>,
  child_size: Int,
  min_prefix_length: Int,
  max_prefix_length: Int,
  empty_child: ByteArray,
  hash: HashOp,
}

pub fn null_proof_specs() -> ProofSpec {
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
