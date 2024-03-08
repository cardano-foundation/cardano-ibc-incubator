use aiken/bytearray
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentRoot, ExistenceProof, ProofSpec,
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
  proof.verify(ep, spec, root, key, value)
}

fn get_exist_proof_for_key(
  comm_proof: CommitmentProof,
  key: ByteArray,
) -> ExistenceProof {
  expect comm_proof != proofs.null_commitment_proof()
  if bytearray.compare(comm_proof.proof.exist.key, key) == Equal {
    comm_proof.proof.exist
  } else {
    proofs.null_existance_proof()
  }
}
