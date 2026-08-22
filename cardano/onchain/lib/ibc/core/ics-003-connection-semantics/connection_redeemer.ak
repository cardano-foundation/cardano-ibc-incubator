use aiken/crypto.{VerificationKeyHash}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

pub type MintConnectionRedeemer {
  ConnOpenInit
  ConnOpenTry {
    client_state: ByteArray,
    proof_init: MerkleProof,
    proof_client: MerkleProof,
    proof_height: Height,
  }
  BurnConnection { token: AuthToken, reclaim_to: VerificationKeyHash }
}

pub type SpendConnectionRedeemer {
  ConnOpenAck
  ConnOpenConfirm { proof_ack: MerkleProof, proof_height: Height }
  IncrementChannelCount
  DecrementChannelCount
  BeginConnectionRetirement { not_before: Int }
  ReclaimConnection { reclaim_to: VerificationKeyHash }
}
