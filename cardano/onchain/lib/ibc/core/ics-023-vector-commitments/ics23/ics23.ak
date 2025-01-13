use aiken/primitive/bytearray
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Batch, CommitmentProof_Compressed,
  CommitmentProof_Exist, CommitmentProof_Nonexist, CommitmentRoot,
  ExistenceProof, NonExistenceProof, ProofSpec,
}

pub fn verify_membership(
  spec: ProofSpec,
  root: CommitmentRoot,
  comm_proof: CommitmentProof,
  key: ByteArray,
  value: ByteArray,
) -> Bool {
  let ep = get_exist_proof_for_key(comm_proof, key)
  expect ep != proofs.null_existance_proof()
  proof.verify_existence_proof(ep, spec, root, key, value)
}

fn get_exist_proof_for_key(
  comm_proof: CommitmentProof,
  key: ByteArray,
) -> ExistenceProof {
  expect comm_proof != proofs.null_commitment_proof()
  when comm_proof.proof is {
    CommitmentProof_Exist { exist } ->
      if exist.key == key {
        exist
      } else {
        proofs.null_existance_proof()
      }
    CommitmentProof_Nonexist { .. } -> fail
    CommitmentProof_Batch -> fail
    CommitmentProof_Compressed -> fail
  }
}

pub fn verify_non_membership(
  spec: ProofSpec,
  root: CommitmentRoot,
  comm_proof: CommitmentProof,
  key: ByteArray,
) -> Bool {
  let np = get_non_exist_proof_for_key(spec, comm_proof, key)
  expect np != proofs.null_non_existance_proof()
  proof.verify_non_existence_proof(np, spec, root, key)
}

pub fn get_non_exist_proof_for_key(
  spec: ProofSpec,
  comm_proof: CommitmentProof,
  key: ByteArray,
) -> NonExistenceProof {
  when comm_proof.proof is {
    CommitmentProof_Exist { .. } -> fail
    CommitmentProof_Nonexist { non_exist } ->
      if is_left(spec, non_exist.left, key) && is_right(
        spec,
        non_exist.right,
        key,
      ) {
        non_exist
      } else {
        proofs.null_non_existance_proof()
      }
    CommitmentProof_Batch -> fail
    CommitmentProof_Compressed -> fail
  }
}

fn is_left(spec: ProofSpec, left: ExistenceProof, key: ByteArray) -> Bool {
  left == proofs.null_existance_proof() || bytearray.compare(
    proof.key_for_comparison(spec, left.key),
    proof.key_for_comparison(spec, key),
  ) == Less
}

fn is_right(spec: ProofSpec, right: ExistenceProof, key: ByteArray) -> Bool {
  right == proofs.null_existance_proof() || bytearray.compare(
    proof.key_for_comparison(spec, right.key),
    proof.key_for_comparison(spec, key),
  ) == Greater
}
