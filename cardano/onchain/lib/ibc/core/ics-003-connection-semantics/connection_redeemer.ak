use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

pub type MintConnectionRedeemer {
  ConnOpenInit { handler_auth_token: AuthToken }
  ConnOpenTry {
    handler_auth_token: AuthToken,
    client_state: ByteArray,
    proof_init: MerkleProof,
    proof_client: MerkleProof,
    proof_height: Height,
  }
}

pub type SpendConnectionRedeemer {
  ConnOpenAck {
    counterparty_client_state: ByteArray,
    proof_try: MerkleProof,
    proof_client: MerkleProof,
    proof_height: Height,
  }
  ConnOpenConfirm { proof_ack: MerkleProof, proof_height: Height }
}
