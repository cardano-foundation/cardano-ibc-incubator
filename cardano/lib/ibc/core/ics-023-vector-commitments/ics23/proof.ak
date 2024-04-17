use aiken/builtin.{if_then_else}
use aiken/bytearray
use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/ops
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Batch, CommitmentProof_Compressed,
  CommitmentProof_Exist, CommitmentProof_Nonexist, CommitmentRoot,
  ExistenceProof, InnerOp, InnerSpec, LeafOp, NonExistenceProof, ProofSpec,
}

/// calculate() determines the root hash that matches a given Commitment proof
pub fn calculate(p: CommitmentProof) -> CommitmentRoot {
  when p.proof is {
    CommitmentProof_Exist { exist } -> calculate_exist(exist)
    CommitmentProof_Nonexist { non_exist } -> calculate_non_exist(non_exist)
    CommitmentProof_Batch -> #[]
    CommitmentProof_Compressed -> #[]
  }
}

/// verify_existence_proof() does all checks to ensure this proof proves this key, value -> root
/// and matches the spec.
pub fn verify_existence_proof(
  p: ExistenceProof,
  spec: ProofSpec,
  root: CommitmentRoot,
  key: ByteArray,
  value: ByteArray,
) -> Bool {
  and {
    check_against_spec(p, spec),
    key == p.key,
    value == p.value,
    root == calculate_exist_internal(p, spec),
  }
}

/// Verify does all checks to ensure the proof has valid non-existence proofs,
/// and they ensure the given key is not in the CommitmentState
pub fn verify_non_existence_proof(
  p: NonExistenceProof,
  spec: ProofSpec,
  root: CommitmentRoot,
  key: ByteArray,
) -> Bool {
  // ensure the existence proofs left and right are valid
  let left_key =
    if_then_else(
      p.left != proofs.null_existance_proof(),
      {
        expect
          verify_existence_proof(p.left, spec, root, p.left.key, p.left.value)
        p.left.key
      },
      #[],
    )
  let right_key =
    if_then_else(
      p.right != proofs.null_existance_proof(),
      {
        expect
          verify_existence_proof(
            p.right,
            spec,
            root,
            p.right.key,
            p.right.value,
          )
        p.right.key
      },
      #[],
    )
  // If both proofs are missing, this is not a valid proof
  expect !(bytearray.is_empty(left_key) && bytearray.is_empty(right_key))
  expect
    !(!bytearray.is_empty(right_key) && !(bytearray.compare(
      key_for_comparison(spec, key),
      key_for_comparison(spec, right_key),
    ) == Less))
  expect
    !(!bytearray.is_empty(left_key) && !(bytearray.compare(
      key_for_comparison(spec, key),
      key_for_comparison(spec, left_key),
    ) == Greater))
  if bytearray.is_empty(left_key) {
    expect is_left_most(spec.inner_spec, p.right.path)
    True
  } else if bytearray.is_empty(right_key) {
    expect is_right_most(spec.inner_spec, p.left.path)
    True
  } else {
    expect is_left_neighbor(spec.inner_spec, p.left.path, p.right.path)
    True
  }
}

/// calculate_exist() determines the root hash that matches a given ExistenceProof proof
pub fn calculate_exist(p: ExistenceProof) -> CommitmentRoot {
  calculate_exist_internal(p, proofs.null_proof_spec())
}

/// calculate_non_exist() determines the root hash that matches the given nonexistence 
pub fn calculate_non_exist(p: NonExistenceProof) -> CommitmentRoot {
  if p.left != proofs.null_existance_proof() {
    calculate_exist(p.left)
  } else {
    if p.right != proofs.null_existance_proof() {
      calculate_exist(p.right)
    } else {
      fail
    }
  }
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
  expect spec != proofs.null_proof_spec()
  expect spec.leaf_spec != proofs.null_leaf_op()

  let is_iavl_spec = proofs.spec_equals(spec, proofs.iavl_spec())

  let leaf = get_leaf_existence_proof(p)
  expect leaf != proofs.null_leaf_op()
  expect ops.check_against_spec_leaf_op(leaf, spec, is_iavl_spec)
  expect !(spec.min_depth > 0 && list.length(p.path) < spec.min_depth)
  expect !(spec.max_depth > 0 && list.length(p.path) > spec.max_depth)

  let inner_spec = spec.inner_spec
  expect inner_spec != proofs.null_inner_spec()

  let max_op_prefix_length =
    ( list.length(inner_spec.child_order) - 1 ) * inner_spec.child_size + inner_spec.max_prefix_length

  let layer_num = 1
  let accum_layer_num =
    list.reduce(
      p.path,
      layer_num,
      fn(accum_layer_num, inner) {
        expect
          ops.check_against_spec_inner_op(
            inner,
            spec,
            layer_num,
            inner_spec,
            max_op_prefix_length,
            is_iavl_spec,
          )
        accum_layer_num + 1
      },
    )
  // Alway true - Use an obviously true statement to get rid of unused warning
  expect accum_layer_num >= 1
  True
}

pub fn key_for_comparison(spec: ProofSpec, key: ByteArray) -> ByteArray {
  if !spec.prehash_key_before_comparison {
    key
  } else {
    ops.do_hash_or_no_op(spec.leaf_spec.prehash_key, key)
  }
}

fn get_leaf_existence_proof(p: ExistenceProof) -> LeafOp {
  p.leaf
}

/// is_left_most() returns true if this is the left-most path in the tree, excluding placeholder (empty child) nodes
pub fn is_left_most(spec: InnerSpec, path: List<InnerOp>) -> Bool {
  let (min_prefix, max_prefix, suffix) = get_padding(spec, 0)

  // ensure every step has a prefix and suffix defined to be leftmost, unless it is a placeholder node
  let (is_lm, _is_break) =
    path
      |> list.reduce(
           (True, False),
           fn(accum, step) {
             if accum.2nd == False {
               if
               !has_padding(step, min_prefix, max_prefix, suffix) && !left_branches_are_empty(
                 spec,
                 step,
               ){
               
                 (False, True)
               } else {
                 (True, False)
               }
             } else {
               (False, True)
             }
           },
         )
  is_lm
}

/// is_right_most() returns true if this is the left-most path in the tree, excluding placeholder (empty child) nodes
pub fn is_right_most(spec: InnerSpec, path: List<InnerOp>) -> Bool {
  let last = list.length(spec.child_order) - 1
  let (min_prefix, max_prefix, suffix) = get_padding(spec, last)

  // ensure every step has a prefix and suffix defined to be rightmost, unless it is a placeholder node
  let (is_rm, _is_break) =
    path
      |> list.reduce(
           (True, False),
           fn(accum, step) {
             if accum.2nd == False {
               if
               !has_padding(step, min_prefix, max_prefix, suffix) && !right_branches_are_empty(
                 spec,
                 step,
               ){
               
                 (False, True)
               } else {
                 (True, False)
               }
             } else {
               (False, True)
             }
           },
         )
  is_rm
}

/// is_left_neighbor() returns true if `right` is the next possible path right of `left`
pub fn is_left_neighbor(
  spec: InnerSpec,
  left: List<InnerOp>,
  right: List<InnerOp>,
) -> Bool {
  let (l, r, opt_top_left, otp_top_right, _is_break) =
    list.range(0, list.length(left) - 1)
      |> list.reduce(
           (
             list.slice(left, 0, list.length(left) - 2),
             list.slice(right, 0, list.length(right) - 2),
             list.at(left, list.length(left) - 1),
             list.at(right, list.length(right) - 1),
             False,
           ),
           fn(accum, _i) {
             if accum.5th == False {
               expect Some(t_left) = accum.3rd
               expect Some(t_right) = accum.4th
               if
               t_left.prefix == t_right.prefix && t_left.suffix == t_right.suffix{
               
                 if list.length(accum.1st) < 2 && list.length(accum.2nd) < 2 {
                   (
                     [],
                     [],
                     list.at(accum.1st, list.length(accum.1st) - 1),
                     list.at(accum.2nd, list.length(accum.2nd) - 1),
                     False,
                   )
                 } else if list.length(accum.1st) < 2 && list.length(accum.2nd) >= 2 {
                   (
                     [],
                     list.slice(accum.2nd, 0, list.length(accum.2nd) - 2),
                     list.at(accum.1st, list.length(accum.1st) - 1),
                     list.at(accum.2nd, list.length(accum.2nd) - 1),
                     False,
                   )
                 } else if list.length(accum.1st) >= 2 && list.length(accum.2nd) < 2 {
                   (
                     list.slice(accum.1st, 0, list.length(accum.1st) - 2),
                     [],
                     list.at(accum.1st, list.length(accum.1st) - 1),
                     list.at(accum.2nd, list.length(accum.2nd) - 1),
                     False,
                   )
                 } else {
                   (
                     list.slice(accum.1st, 0, list.length(accum.1st) - 2),
                     list.slice(accum.2nd, 0, list.length(accum.2nd) - 2),
                     list.at(accum.1st, list.length(accum.1st) - 1),
                     list.at(accum.2nd, list.length(accum.2nd) - 1),
                     False,
                   )
                 }
               } else {
                 (accum.1st, accum.2nd, accum.3rd, accum.4th, True)
               }
             } else {
               accum
             }
           },
         )
  expect Some(top_left) = opt_top_left
  expect Some(top_right) = otp_top_right
  if
  !is_left_step(spec, top_left, top_right) || !is_right_most(spec, l) || !is_left_most(
    spec,
    r,
  ){
  
    False
  } else {
    True
  }
}

/// is_left_step() assumes left and right have common parents
/// checks if left is exactly one slot to the left of right
pub fn is_left_step(spec: InnerSpec, left: InnerOp, right: InnerOp) -> Bool {
  order_from_padding(spec, right) == order_from_padding(spec, left) + 1
}

/// has_padding() checks if an op has the expected padding
fn has_padding(
  op: InnerOp,
  min_prefix: Int,
  max_prefix: Int,
  suffix: Int,
) -> Bool {
  if
  bytearray.length(op.prefix) < min_prefix || bytearray.length(op.prefix) > max_prefix{
  
    False
  } else {
    bytearray.length(op.suffix) == suffix
  }
}

/// get_padding() determines prefix and suffix with the given spec and position in the tree
fn get_padding(spec: InnerSpec, branch: Int) -> (Int, Int, Int) {
  let idx = get_position(spec.child_order, branch)

  // count how many children are in the prefix
  let prefix = idx * spec.child_size
  let min_prefix = prefix + spec.min_prefix_length
  let max_prefix = prefix + spec.max_prefix_length

  // count how many children are in the suffix
  let suffix = ( list.length(spec.child_order) - 1 - idx ) * spec.child_size
  (min_prefix, max_prefix, suffix)
}

/// left_branches_are_empty() returns true if the padding bytes correspond to all empty siblings
/// on the left side of a branch, ie. it's a valid placeholder on a leftmost path
fn left_branches_are_empty(spec: InnerSpec, op: InnerOp) -> Bool {
  let left_branches = order_from_padding(spec, op)
  let actual_prefix =
    bytearray.length(op.prefix) - left_branches * spec.child_size
  if left_branches == 0 || actual_prefix < 0 {
    False
  } else {
    let (is_correspond, _is_break) =
      list.range(0, left_branches - 1)
        |> list.reduce(
             (True, False),
             fn(accum, i) {
               if accum.2nd == False {
                 let idx = get_position(spec.child_order, i)
                 let from = actual_prefix + idx * spec.child_size
                 if
                 !(spec.empty_child == bytearray.slice(
                   op.prefix,
                   from,
                   from + spec.child_size - 1,
                 )){
                 
                   (False, True)
                 } else {
                   (True, False)
                 }
               } else {
                 (False, True)
               }
             },
           )
    is_correspond
  }
}

/// right_branches_are_empty() returns true if the padding bytes correspond to all empty siblings
/// on the right side of a branch, ie. it's a valid placeholder on a rightmost path
fn right_branches_are_empty(spec: InnerSpec, op: InnerOp) -> Bool {
  let right_branches =
    list.length(spec.child_order) - 1 - order_from_padding(spec, op)
  if
  right_branches == 0 || bytearray.length(op.suffix) != right_branches * spec.child_size{
  
    False
  } else {
    let (is_correspond, _is_break) =
      list.range(0, right_branches - 1)
        |> list.reduce(
             (True, False),
             fn(accum, i) {
               if accum.2nd == False {
                 let idx = get_position(spec.child_order, i)
                 let from = idx * spec.child_size
                 if
                 !(spec.empty_child == bytearray.slice(
                   op.suffix,
                   from,
                   from + spec.child_size - 1,
                 )){
                 
                   (False, True)
                 } else {
                   (True, False)
                 }
               } else {
                 (False, True)
               }
             },
           )
    is_correspond
  }
}

/// getPosition checks where the branch is in the order and returns
/// the index of this branch
fn get_position(order: List<Int>, branch: Int) -> Int {
  expect !(branch < 0 || branch >= list.length(order))
  expect Some(index) = list.index_of(order, branch)
  index
}

/// This will look at the proof and determine which order it is...
/// So we can see if it is branch 0, 1, 2 etc... to determine neighbors
fn order_from_padding(spec: InnerSpec, inner: InnerOp) -> Int {
  let max_branch = list.length(spec.child_order)
  let (order, is_find) =
    list.range(0, max_branch - 1)
      |> list.reduce(
           (0, False),
           fn(accum, i) {
             if accum.2nd == False {
               let (minp, maxp, suffix) = get_padding(spec, i)
               if has_padding(inner, minp, maxp, suffix) {
                 (i, True)
               } else {
                 (0, False)
               }
             } else {
               (accum.1st, True)
             }
           },
         )
  expect is_find
  order
}
