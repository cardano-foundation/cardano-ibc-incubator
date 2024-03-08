use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  ExistenceProof, InnerOp, InnerSpec, LeafOp, ProofSpec,
}

test test_check_against_spec() {
  let valid_proof =
    ExistenceProof {
      key: "Zm9vZA==",
      value: "YmFy",
      leaf: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: "AA==",
      },
      path: [
        InnerOp { hash: 1, prefix: "qrvM3Q==", suffix: #[] },
        InnerOp { hash: 1, prefix: "qrvM3Q==", suffix: #[] },
      ],
    }
  let spec =
    ProofSpec {
      leaf_spec: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: "AA==",
      },
      inner_spec: InnerSpec {
        child_order: [0, 1],
        child_size: 33,
        min_prefix_length: 4,
        max_prefix_length: 12,
        empty_child: #[],
        hash: 1,
      },
      max_depth: 0,
      min_depth: 0,
      prehash_key_before_comparison: False,
    }
  True
  // proof.check_against_spec(valid_proof, spec)
}
