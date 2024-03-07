use aiken/bytearray
use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/ops
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentRoot, ExistenceProof, LeafOp, ProofSpec,
}

/// calculate() determines the root hash that matches a given Commitment proof
pub fn calculate(p: CommitmentProof) -> CommitmentRoot {
  calculate_exist(p.proof.exist)
}

/// verify() does all checks to ensure this proof proves this key, value -> root
/// and matches the spec.
pub fn verify(
  p: ExistenceProof,
  spec: ProofSpec,
  root: CommitmentRoot,
  key: ByteArray,
  value: ByteArray,
) -> Bool {
  expect check_against_spec(p, spec)
  expect bytearray.compare(key, p.key) == Equal
  expect bytearray.compare(value, p.value) == Equal
  let calc = calculate_exist_internal(p, spec)
  expect bytearray.compare(root, calc) == Equal
  True
}

/// calculate_exist() determines the root hash that matches a given ExistenceProof proof
pub fn calculate_exist(p: ExistenceProof) -> CommitmentRoot {
  calculate_exist_internal(p, proofs.null_proof_spec())
}

fn calculate_exist_internal(
  p: ExistenceProof,
  spec: ProofSpec,
) -> CommitmentRoot {
  expect get_leaf_existence_proof(p) != proofs.null_leaf_op()
  let res = ops.apply_leaf_op(p.leaf, p.key, p.value)
  let result =
    list.reduce(
      p.path,
      res,
      fn(accum_res, step) {
        if spec == proofs.null_proof_spec() {
          ops.apply_inner_op(step, accum_res)
        } else {
          let temp_accum_res = ops.apply_inner_op(step, accum_res)
          expect
            !(bytearray.length(temp_accum_res) > spec.inner_spec.child_size && spec.inner_spec.child_size >= 32)
          temp_accum_res
        }
      },
    )
  result
}

/// check_against_spec() will verify the leaf and all path steps are in the format defined in spec
pub fn check_against_spec(p: ExistenceProof, spec: ProofSpec) -> Bool {
  let leaf = get_leaf_existence_proof(p)
  expect leaf != proofs.null_leaf_op()
  expect ops.check_against_spec_leaf_op(leaf, spec)
  expect !(spec.min_depth > 0 && list.length(p.path) < spec.min_depth)
  expect !(spec.max_depth > 0 && list.length(p.path) > spec.max_depth)
  let layer_num = 1
  let accum_layer_num =
    list.reduce(
      p.path,
      layer_num,
      fn(accum_layer_num, inner) {
        expect ops.check_against_spec_inner_op(inner, spec, layer_num)
        accum_layer_num + 1
      },
    )
  // Alway true - Use an obviously true statement to get rid of unused warning
  expect accum_layer_num >= 1
  True
}

fn get_leaf_existence_proof(p: ExistenceProof) -> LeafOp {
  p.leaf
}
