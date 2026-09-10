use aiken/collection/list
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  InnerSpec, LeafOp, ProofSpec,
}

test sdk_specs_require_exact_order_and_count() {
  let iavl = proofs.iavl_spec()
  let tendermint = proofs.tendermint_spec()
  and {
    proofs.validate_specs([iavl, tendermint]),
    !proofs.validate_specs([tendermint, iavl]),
    !proofs.validate_specs([iavl]),
    !proofs.validate_specs([iavl, tendermint, iavl]),
    !proofs.validate_specs([]),
  }
}

test spec_comparison_checks_every_field() {
  let spec = proofs.iavl_spec()
  let leaf = spec.leaf_spec
  let inner = spec.inner_spec
  let changed =
    [
      ProofSpec { ..spec, leaf_spec: LeafOp { ..leaf, hash: 0 } },
      ProofSpec { ..spec, leaf_spec: LeafOp { ..leaf, prehash_key: 1 } },
      ProofSpec { ..spec, leaf_spec: LeafOp { ..leaf, prehash_value: 0 } },
      ProofSpec { ..spec, leaf_spec: LeafOp { ..leaf, length: 0 } },
      ProofSpec { ..spec, leaf_spec: LeafOp { ..leaf, prefix: #"01" } },
      ProofSpec {
        ..spec,
        inner_spec: InnerSpec { ..inner, child_order: [1, 0] },
      },
      ProofSpec { ..spec, inner_spec: InnerSpec { ..inner, child_size: 32 } },
      ProofSpec {
        ..spec,
        inner_spec: InnerSpec { ..inner, min_prefix_length: 3 },
      },
      ProofSpec {
        ..spec,
        inner_spec: InnerSpec { ..inner, max_prefix_length: 13 },
      },
      ProofSpec {
        ..spec,
        inner_spec: InnerSpec { ..inner, empty_child: #"00" },
      },
      ProofSpec { ..spec, inner_spec: InnerSpec { ..inner, hash: 0 } },
      ProofSpec { ..spec, max_depth: 1 },
      ProofSpec { ..spec, min_depth: 1 },
      ProofSpec { ..spec, prehash_key_before_comparison: True },
    ]
  list.all(changed, fn(other) { !proofs.spec_equals(spec, other) })
}
