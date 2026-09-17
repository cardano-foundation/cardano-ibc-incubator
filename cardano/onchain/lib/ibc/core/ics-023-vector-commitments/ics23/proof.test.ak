use aiken/collection/list
use aiken/fuzz
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
  NonExistenceProof, ProofSpec,
}

fn valid_iavl_leaf() -> LeafOp {
  LeafOp {
    hash: 1,
    prehash_key: 0,
    prehash_value: 1,
    length: 1,
    prefix: #"000202",
  }
}

fn iavl_inner_with_height_129() -> InnerOp {
  InnerOp {
    hash: 1,
    prefix: #"8202060220",
    suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
  }
}

fn iavl_inner_with_height_2() -> InnerOp {
  InnerOp {
    hash: 1,
    prefix: #"04060220",
    suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
  }
}

fn iavl_existence_proof(path: List<InnerOp>) -> ExistenceProof {
  ExistenceProof { key: #"01", value: #"02", leaf: valid_iavl_leaf(), path }
}

test test_caculate_success() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          key: #"3033763434454574647248423556417579715966",
          value: #"76616c75655f666f725f3033763434454574647248423556417579715966",
          leaf: LeafOp {
            hash: 1,
            prehash_key: 0,
            prehash_value: 1,
            length: 1,
            prefix: #"000202",
          },
          path: [
            InnerOp {
              hash: 1,
              prefix: #"04060220",
              suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
            },
            InnerOp {
              hash: 1,
              prefix: #"060c0220",
              suffix: #"205e1712938d9dcef396a76bbd7ea844bcc7e72a64d416485ba14e8c679402dfc3",
            },
            InnerOp {
              hash: 1,
              prefix: #"08180220",
              suffix: #"20c6a6430436f6e95ab0c90d7c3d32c7e62884a1e28e22da87f9e8c863782b7195",
            },
            InnerOp {
              hash: 1,
              prefix: #"0a2c0220",
              suffix: #"201204acd0c729844aa19ffa80cfdfcb931f1ea54167babe1872a2fdcdf520962a",
            },
            InnerOp {
              hash: 1,
              prefix: #"0c440220",
              suffix: #"20c21911260b253d74c89d95ec7534b7499b98a8b7523857f7f31e6af723245b89",
            },
            InnerOp {
              hash: 1,
              prefix: #"0e6e0220",
              suffix: #"2045a06e0b8f7391f60a5f716eeef9eb01d8c588bbdbfb4e6a67718e92ab3ed12d",
            },
            InnerOp {
              hash: 1,
              prefix: #"1296020220",
              suffix: #"209b77ab64f5b7c290b608533b70612d18a0d55ede4ccb2f9418b56aa17069e966",
            },
            InnerOp {
              hash: 1,
              prefix: #"14e6030220",
              suffix: #"20246dce928b807f040230219a808c049d7a172108db6b1c83c445c66373ea4cd9",
            },
            InnerOp {
              hash: 1,
              prefix: #"1680080220",
              suffix: #"20ec794fb7e49d3d3554680ad0df7d1cc3797201fe33fc8288581f7ad32bb995c0",
            },
            InnerOp {
              hash: 1,
              prefix: #"18b60f0220",
              suffix: #"203b05428644520c7bae4be197ecb6de54a03a18a1ebd34836eea31fe593a6b6e0",
            },
          ],
        },
      },
    }
  let expected_calculate_root =
    #"77e43ef93047a91fe457f5498bd7afc60b9dddd661d8f1225e5f40a91bda4623"
  proof.calculate(valid_proof) == expected_calculate_root
}

test test_check_against_iavl_spec_accepts_default_max_depth() {
  let path = list.repeat(iavl_inner_with_height_129(), 128)
  proof.check_against_spec(iavl_existence_proof(path), proofs.iavl_spec())
}

test test_check_against_iavl_spec_rejects_above_default_max_depth() fail {
  let path = list.repeat(iavl_inner_with_height_129(), 129)
  proof.check_against_spec(iavl_existence_proof(path), proofs.iavl_spec())
}

test test_check_against_iavl_spec_rejects_low_height_at_deeper_layer() fail {
  let path = list.repeat(iavl_inner_with_height_2(), 3)
  proof.check_against_spec(iavl_existence_proof(path), proofs.iavl_spec())
}

test checked_root_preserves_the_validated_root() {
  let p = iavl_existence_proof([iavl_inner_with_height_2()])
  proof.calculate_checked_existence_root(p, proofs.iavl_spec(), p.key, p.value) == proof.calculate_exist(
    p,
  )
}

fn checked_root(
  p: ExistenceProof,
  spec: ProofSpec,
  key: ByteArray,
  value: ByteArray,
) -> Bool {
  let root = proof.calculate_checked_existence_root(p, spec, key, value)
  root != #[]
}

test checked_root_rejects_wrong_key() fail {
  let p = iavl_existence_proof([])
  checked_root(p, proofs.iavl_spec(), #"03", p.value)
}

test checked_root_rejects_wrong_value() fail {
  let p = iavl_existence_proof([])
  checked_root(p, proofs.iavl_spec(), p.key, #"03")
}

test checked_root_rejects_empty_key() fail {
  let p = ExistenceProof { ..iavl_existence_proof([]), key: #[] }
  checked_root(p, proofs.iavl_spec(), p.key, p.value)
}

test checked_root_rejects_empty_value() fail {
  let p = ExistenceProof { ..iavl_existence_proof([]), value: #[] }
  checked_root(p, proofs.iavl_spec(), p.key, p.value)
}

test checked_root_rejects_null_proof() fail {
  let p = proofs.null_existance_proof()
  checked_root(p, proofs.iavl_spec(), p.key, p.value)
}

test checked_root_rejects_null_spec() fail {
  let p = iavl_existence_proof([])
  checked_root(p, proofs.null_proof_spec(), p.key, p.value)
}

test checked_root_rejects_wrong_leaf_spec() fail {
  let p = iavl_existence_proof([])
  let spec = proofs.iavl_spec()
  let changed =
    ProofSpec { ..spec, leaf_spec: LeafOp { ..spec.leaf_spec, length: 0 } }
  checked_root(p, changed, p.key, p.value)
}

test checked_root_rejects_wrong_inner_hash() fail {
  let p =
    iavl_existence_proof([InnerOp { ..iavl_inner_with_height_2(), hash: 2 }])
  checked_root(p, proofs.iavl_spec(), p.key, p.value)
}

test checked_root_rejects_below_minimum_depth() fail {
  let p = iavl_existence_proof([])
  let spec = ProofSpec { ..proofs.iavl_spec(), min_depth: 1 }
  checked_root(p, spec, p.key, p.value)
}

test checked_root_rejects_above_default_depth() fail {
  let p = iavl_existence_proof(list.repeat(iavl_inner_with_height_129(), 129))
  checked_root(p, proofs.iavl_spec(), p.key, p.value)
}

const left_step =
  InnerOp {
    hash: 1,
    prefix: #"01",
    suffix: #"afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
  }

const right_step =
  InnerOp {
    hash: 1,
    prefix: #"01afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
    suffix: #[],
  }

// Test-only model of the ICS-23 root-to-leaf comparison using last/take pops.
// None represents exhaustion before finding a divergent step.
fn reference_neighbors(
  left: List<InnerOp>,
  right: List<InnerOp>,
) -> Option<Bool> {
  let left_length = list.length(left)
  let right_length = list.length(right)
  reference_neighbor_loop(
    list.take(left, left_length - 1),
    list.take(right, right_length - 1),
    list.at(left, left_length - 1),
    list.at(right, right_length - 1),
    left_length,
  )
}

fn reference_neighbor_loop(
  left: List<InnerOp>,
  right: List<InnerOp>,
  top_left: Option<InnerOp>,
  top_right: Option<InnerOp>,
  remaining: Int,
) -> Option<Bool> {
  when (top_left, top_right) is {
    (Some(l), Some(r)) ->
      if remaining > 0 && l.prefix == r.prefix && l.suffix == r.suffix {
        let left_length = list.length(left)
        let right_length = list.length(right)
        reference_neighbor_loop(
          list.take(left, left_length - 1),
          list.take(right, right_length - 1),
          list.at(left, left_length - 1),
          list.at(right, right_length - 1),
          remaining - 1,
        )
      } else {
        let spec = proofs.tendermint_spec().inner_spec
        Some(and {
            proof.is_left_step(spec, l, r),
            proof.is_right_most(spec, left),
            proof.is_left_most(spec, right),
          })
      }
    _ -> None
  }
}

fn neighbor_paths() -> Fuzzer<(List<InnerOp>, List<InnerOp>)> {
  let step =
    fuzz.map(
      fuzz.bool(),
      fn(left) {
        if left {
          left_step
        } else {
          right_step
        }
      },
    )
  fuzz.map3(
    fuzz.list_between(step, 0, 8),
    fuzz.list_between(step, 0, 8),
    fuzz.list_between(step, 0, 24),
    fn(left, right, shared) {
      (list.concat(left, shared), list.concat(right, shared))
    },
  )
}

fn exhausted_neighbor_paths() -> Fuzzer<(List<InnerOp>, List<InnerOp>)> {
  fuzz.such_that(
    neighbor_paths(),
    fn(paths) { reference_neighbors(paths.1st, paths.2nd) == None },
  )
}

fn evaluated_neighbor_paths() -> Fuzzer<(List<InnerOp>, List<InnerOp>)> {
  fuzz.such_that(
    neighbor_paths(),
    fn(paths) { reference_neighbors(paths.1st, paths.2nd) != None },
  )
}

test prop_proof_neighbors_match_reference_result(
  paths via evaluated_neighbor_paths(),
) {
  fuzz.label(@"fuzz.unit.proof.neighbor_result")
  expect Some(expected) = reference_neighbors(paths.1st, paths.2nd)
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    paths.1st,
    paths.2nd,
  ) == expected
}

// Testing both the result and its negation distinguishes an evaluation failure
// from either Bool result, even under an expected-failure test runner.
test prop_proof_neighbors_preserve_exhaustion_failure(
  paths via exhausted_neighbor_paths(),
) fail {
  fuzz.label(@"fuzz.unit.proof.neighbor_exhaustion")
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    paths.1st,
    paths.2nd,
  )
}

test prop_proof_neighbors_preserve_exhaustion_failure_negated(
  paths via exhausted_neighbor_paths(),
) fail {
  fuzz.label(@"fuzz.unit.proof.neighbor_exhaustion_negated")
  !proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    paths.1st,
    paths.2nd,
  )
}

test neighbors_accept_singleton_siblings() {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [left_step],
    [right_step],
  )
}

test neighbors_accept_one_singleton_path() {
  let spec = proofs.tendermint_spec().inner_spec
  and {
    proof.is_left_neighbor(spec, [left_step], [left_step, right_step]),
    proof.is_left_neighbor(spec, [right_step, left_step], [right_step]),
  }
}

test neighbors_reject_non_adjacent_singleton_paths() {
  let spec = proofs.tendermint_spec().inner_spec
  and {
    !proof.is_left_neighbor(spec, [right_step], [left_step]),
    !proof.is_left_neighbor(spec, [left_step], [right_step, right_step]),
    !proof.is_left_neighbor(spec, [left_step, left_step], [right_step]),
  }
}

test neighbors_reject_identical_singleton_paths() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [left_step],
    [left_step],
  )
}

test neighbors_reject_exhausted_singleton_left() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [left_step],
    [right_step, left_step],
  )
}

test neighbors_reject_exhausted_singleton_right() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [left_step, right_step],
    [right_step],
  )
}

test neighbors_reject_empty_left() fail {
  proof.is_left_neighbor(proofs.tendermint_spec().inner_spec, [], [right_step])
}

test neighbors_reject_empty_right() fail {
  proof.is_left_neighbor(proofs.tendermint_spec().inner_spec, [left_step], [])
}

test neighbors_reject_identical_multistep_paths() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [left_step, right_step],
    [left_step, right_step],
  )
}

test neighbors_reject_exhausted_shorter_left() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [right_step, left_step],
    [left_step, right_step, left_step],
  )
}

test neighbors_reject_exhausted_shorter_right() fail {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [right_step, left_step, right_step],
    [left_step, right_step],
  )
}

test neighbors_compare_common_padding_without_rechecking_hashes() {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    [right_step, left_step, left_step],
    [left_step, right_step, InnerOp { ..left_step, hash: 2 }],
  )
}

// Generated with cosmos/iavl v1.2.2: insert 01 -> 02 and 03 -> 04, save
// version 1, then GetNonMembershipProof(02). The proof and root were verified
// with cosmos/ics23/go v0.11.0 VerifyNonMembership and IavlSpec.
const two_leaf_iavl_root =
  #"22c267d178aed04a4510703a7290b8e46ae2505eaf86612cecd73c2e62f9095c"

fn two_leaf_iavl_non_existence_proof() -> NonExistenceProof {
  NonExistenceProof {
    key: #"02",
    left: ExistenceProof {
      key: #"01",
      value: #"02",
      leaf: valid_iavl_leaf(),
      path: [
        InnerOp {
          hash: 1,
          prefix: #"02040220",
          suffix: #"2057dd7f756aa95cd624e31d387bb2a157b760071064e20c1f2e158b407d94c819",
        },
      ],
    },
    right: ExistenceProof {
      key: #"03",
      value: #"04",
      leaf: valid_iavl_leaf(),
      path: [
        InnerOp {
          hash: 1,
          prefix: #"02040220f3b4c1517dc8ee8ee9a30b3c3c64fb1290c35d86b5699b76c66a0213d3e90c0420",
          suffix: #[],
        },
      ],
    },
  }
}

test non_existence_accepts_two_leaf_iavl_neighbors() {
  let p = two_leaf_iavl_non_existence_proof()
  proof.verify_non_existence_proof(
    p,
    proofs.iavl_spec(),
    two_leaf_iavl_root,
    p.key,
  )
}

test non_existence_rejects_two_leaf_iavl_boundary_keys() {
  let p = two_leaf_iavl_non_existence_proof()
  and {
    !proof.verify_non_existence_proof(
      p,
      proofs.iavl_spec(),
      two_leaf_iavl_root,
      p.left.key,
    ),
    !proof.verify_non_existence_proof(
      p,
      proofs.iavl_spec(),
      two_leaf_iavl_root,
      p.right.key,
    ),
  }
}
