use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath, MerkleProof}

pub type VerifyMembershipParams {
  cs: ClientState,
  cons_state: ConsensusState,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: MerkleProof,
  path: MerklePath,
  value: ByteArray,
}

pub type VerifyNonMembershipParams {
  cs: ClientState,
  cons_state: ConsensusState,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: MerkleProof,
  path: MerklePath,
}

pub type VerifyProofRedeemer {
  VerifyMembership {
    cs: ClientState,
    cons_state: ConsensusState,
    height: Height,
    processed_time: Int,
    processed_height: Int,
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
    processed_time: Int,
    processed_height: Int,
    delay_time_period: Int,
    delay_block_period: Int,
    proof: MerkleProof,
    path: MerklePath,
  }

  BatchVerifyMembership(List<VerifyMembershipParams>)

  VerifyOther

  BatchVerifyMembershipAndNonMembership {
    memberships: List<VerifyMembershipParams>,
    non_memberships: List<VerifyNonMembershipParams>,
  }
}

/// History is authenticated by the operation's client NFT reference. The proof
/// marker verifies the unchanged ICS-23 payload selected by that operation.
pub type VerifyProofEnvelope {
  proof: VerifyProofRedeemer,
  history_witness: Option<Witness>,
}
