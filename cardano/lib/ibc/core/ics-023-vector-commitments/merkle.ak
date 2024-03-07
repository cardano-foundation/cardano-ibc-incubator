use aiken/bytearray
use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/ics23
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{CommitmentProof,
  ProofSpec}

pub type MerkleRoot {
  hash: ByteArray,
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

pub type MerklePath {
  key_path: List<ByteArray>,
}

pub type MerkleProof {
  proofs: List<CommitmentProof>,
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

pub fn verify_chained_membership_proof(
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
      (value, index),
      fn(accum, ele_proof) {
        if accum.2nd < index {
          (value, index)
        } else {
          let temp_accum_subroot = proof.calculate(ele_proof)
          let key = get_key(keys, list.length(keys.key_path) - 1 - accum.2nd)
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
      },
    )
  expect bytearray.compare(root, subroot) == Equal
  True
}

/// validate_verification_args() verifies the proof arguments are valid
pub fn validate_verification_args(
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
