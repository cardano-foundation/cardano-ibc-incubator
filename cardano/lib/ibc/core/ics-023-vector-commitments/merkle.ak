use aiken/bytearray
use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/ics23
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Batch, CommitmentProof_Compressed,
  CommitmentProof_Exist, CommitmentProof_Nonexist, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

pub type MerkleRoot {
  hash: ByteArray,
}

pub type MerklePath {
  key_path: List<ByteArray>,
}

pub type MerkleProof {
  proofs: List<CommitmentProof>,
}

pub fn get_sdk_specs() -> List<ProofSpec> {
  [proofs.iavl_spec(), proofs.tendermint_spec()]
}

/// new_merkle_root constructs a new MerkleRoot
pub fn new_merkle_root(hash: ByteArray) -> MerkleRoot {
  MerkleRoot { hash }
}

pub fn get_hash(mr: MerkleRoot) -> ByteArray {
  mr.hash
}

/// is_empty_merkle_root returns true if the root is empty
pub fn is_empty_merkle_root(mr: MerkleRoot) -> Bool {
  bytearray.length(mr.hash) == 0
}

pub fn new_merkle_path(key_path: List<ByteArray>) -> MerklePath {
  MerklePath { key_path }
}

/// get_key() will return a byte representation of the key
pub fn get_key(mp: MerklePath, i: Int) -> ByteArray {
  expect i < list.length(mp.key_path)
  expect Some(res) = list.at(mp.key_path, i)
  res
}

/// is_empty_merkle_proof() returns true if the proof is empty
pub fn is_empty_merkle_proof(mr_proof: MerkleProof) -> Bool {
  mr_proof == null_merkle_proof()
}

/// null_merkle_proof() is used to construct a null merkle proof
pub fn null_merkle_proof() -> MerkleProof {
  MerkleProof { proofs: [] }
}

/// validate_basic() checks if the proof is empty
pub fn validate_basic(mr_proof: MerkleProof) -> Bool {
  expect !is_empty_merkle_proof(mr_proof)
  True
}

pub fn apply_prefix(prefix: MerklePrefix, path: MerklePath) -> MerklePath {
  expect !merkle_prefix.empty(prefix)
  new_merkle_path(list.concat([prefix.key_prefix], path.key_path))
}

/// verify_membership() verifies the membership of a merkle proof against the given root, path, and value.
pub fn verify_membership(
  mr_proof: MerkleProof,
  specs: List<ProofSpec>,
  root: MerkleRoot,
  path: MerklePath,
  value: ByteArray,
) -> Bool {
  expect validate_verification_args(mr_proof, specs, root)
  expect list.length(path.key_path) == list.length(specs)
  expect bytearray.length(value) > 0
  verify_chained_membership_proof(
    get_hash(root),
    specs,
    mr_proof.proofs,
    path,
    value,
    0,
  )
}

/// verify_non_membership() verifies the absence of a merkle proof against the given root and path.
/// verify_non_membership() verifies a chained proof where the absence of a given path is proven
/// at the lowest subtree and then each subtree's inclusion is proved up to the final root.
pub fn verify_non_membership(
  mr_proof: MerkleProof,
  specs: List<ProofSpec>,
  root: MerkleRoot,
  path: MerklePath,
) -> Bool {
  expect validate_verification_args(mr_proof, specs, root)
  expect list.length(path.key_path) == list.length(specs)
  expect Some(first_ele_proof) = mr_proof.proofs |> list.at(0)
  expect Some(first_ele_spec) = specs |> list.at(0)
  when first_ele_proof.proof is {
    CommitmentProof_Exist { .. } -> fail
    CommitmentProof_Nonexist { .. } -> {
      // Verify non membership will verify the absence of key in lowest subtree, and then chain inclusion proofs
      // of all subroots up to final root
      let sub_root = proof.calculate(first_ele_proof)
      expect
        ics23.verify_non_membership(
          first_ele_spec,
          sub_root,
          first_ele_proof,
          get_key(path, list.length(path.key_path) - 1),
        )
      // Verify chained membership proof starting from index 1 with value = subroot
      expect
        verify_chained_membership_proof(
          get_hash(root),
          specs,
          mr_proof.proofs,
          path,
          sub_root,
          1,
        )
      True
    }
    CommitmentProof_Batch -> fail
    CommitmentProof_Compressed -> fail
  }
}

fn verify_chained_membership_proof(
  root: ByteArray,
  specs: List<ProofSpec>,
  proofs: List<CommitmentProof>,
  keys: MerklePath,
  value: ByteArray,
  index: Int,
) -> Bool {
  let (subroot, _idx) =
    list.reduce(
      proofs,
      (value, 0),
      fn(accum, ele_proof) {
        when ele_proof.proof is {
          CommitmentProof_Exist { .. } ->
            if accum.2nd < index {
              (value, index)
            } else {
              let temp_accum_subroot = proof.calculate(ele_proof)
              let key =
                get_key(keys, list.length(keys.key_path) - 1 - accum.2nd)
              expect Some(spec_i) = list.at(specs, accum.2nd)
              expect
                ics23.verify_membership(
                  spec_i,
                  temp_accum_subroot,
                  ele_proof,
                  key,
                  accum.1st,
                )
              (temp_accum_subroot, accum.2nd + 1)
            }
          CommitmentProof_Nonexist { .. } ->
            if accum.2nd == 0 {
              (value, index)
            } else {
              fail
            }
          CommitmentProof_Batch -> fail
          CommitmentProof_Compressed -> fail
        }
      },
    )

  expect bytearray.compare(root, subroot) == Equal
  True
}

/// validate_verification_args() verifies the proof arguments are valid
fn validate_verification_args(
  mr_proof: MerkleProof,
  specs: List<ProofSpec>,
  root: MerkleRoot,
) -> Bool {
  expect !is_empty_merkle_proof(mr_proof)
  expect !is_empty_merkle_root(root)
  expect list.length(specs) == list.length(mr_proof.proofs)
  expect list.all(specs, fn(spec) { spec != proofs.null_proof_spec() })
  True
}
