use aiken/collection/list
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}

// Constants are evaluated at compile time, so fixture construction and trusted
// root calculation are excluded from each verification's execution units.
fn membership_fixture(depth: Int) -> (MerkleProof, MerkleRoot) {
  let lower =
    ExistenceProof {
      key: #"01",
      value: #"02",
      leaf: LeafOp { ..proofs.iavl_spec().leaf_spec, prefix: #"000202" },
      path: list.repeat(
        InnerOp {
          hash: 1,
          prefix: #"8202060220",
          suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
        },
        depth,
      ),
    }
  let upper =
    ExistenceProof {
      key: #"696263",
      value: proof.calculate_exist(lower),
      leaf: proofs.tendermint_spec().leaf_spec,
      path: list.repeat(left_step, depth),
    }
  (
    MerkleProof {
      proofs: [
        CommitmentProof { proof: CommitmentProof_Exist { exist: lower } },
        CommitmentProof { proof: CommitmentProof_Exist { exist: upper } },
      ],
    },
    MerkleRoot { hash: proof.calculate_exist(upper) },
  )
}

fn membership(fixture: (MerkleProof, MerkleRoot)) -> Bool {
  merkle.verify_membership(
    fixture.1st,
    merkle.get_sdk_specs(),
    fixture.2nd,
    MerklePath { key_path: [#"696263", #"01"] },
    #"02",
  )
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

fn neighbor_fixture(shared: Int) -> (List<InnerOp>, List<InnerOp>) {
  let suffix = list.repeat(left_step, shared)
  ([right_step, left_step, ..suffix], [left_step, right_step, ..suffix])
}

fn neighbors(fixture: (List<InnerOp>, List<InnerOp>)) -> Bool {
  proof.is_left_neighbor(
    proofs.tendermint_spec().inner_spec,
    fixture.1st,
    fixture.2nd,
  )
}

const membership_1 = membership_fixture(1)

const membership_8 = membership_fixture(8)

const membership_32 = membership_fixture(32)

const membership_64 = membership_fixture(64)

const membership_128 = membership_fixture(128)

const neighbors_0 = neighbor_fixture(0)

const neighbors_8 = neighbor_fixture(8)

const neighbors_32 = neighbor_fixture(32)

const neighbors_64 = neighbor_fixture(64)

const neighbors_126 = neighbor_fixture(126)

test benchmark_chained_membership_depth_1() {
  membership(membership_1)
}

test benchmark_chained_membership_depth_8() {
  membership(membership_8)
}

test benchmark_chained_membership_depth_32() {
  membership(membership_32)
}

test benchmark_chained_membership_depth_64() {
  membership(membership_64)
}

test benchmark_chained_membership_depth_128() {
  membership(membership_128)
}

test benchmark_neighbors_shared_0() {
  neighbors(neighbors_0)
}

test benchmark_neighbors_shared_8() {
  neighbors(neighbors_8)
}

test benchmark_neighbors_shared_32() {
  neighbors(neighbors_32)
}

test benchmark_neighbors_shared_64() {
  neighbors(neighbors_64)
}

test benchmark_neighbors_shared_126() {
  neighbors(neighbors_126)
}
