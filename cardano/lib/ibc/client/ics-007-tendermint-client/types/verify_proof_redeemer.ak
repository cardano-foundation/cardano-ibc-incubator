use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath, MerkleProof}

pub type VerifyProofRedeemer {
  VerifyMembership {
    cs: ClientState,
    cons_state: ConsensusState,
    height: Height,
    delay_time_period: Int,
    delay_block_period: Int,
    proof: MerkleProof,
    path: MerklePath,
    value: ByteArray,
  }

  VerifyNonMembership {
    cs: ClientState,
    cons_state: ConsensusState,
    height: Height,
    delay_time_period: Int,
    delay_block_period: Int,
    proof: MerkleProof,
    path: MerklePath,
  }

  VerifyOther
}
