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
}

pub type SpendConnectionRedeemer {
  ConnOpenAck
  ConnOpenConfirm { proof_ack: MerkleProof, proof_height: Height }
}
