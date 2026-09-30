use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath}

pub type VerifyMembershipParams {
  cs: Data,
  cons_state: Data,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: Data,
  path: MerklePath,
  value: ByteArray,
}

pub type VerifyNonMembershipParams {
  cs: Data,
  cons_state: Data,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  proof: Data,
  path: MerklePath,
}

pub type VerifyProofRedeemer {
  VerifyMembership {
    cs: Data,
    cons_state: Data,
    height: Height,
    processed_time: Int,
    processed_height: Int,
    delay_time_period: Int,
    delay_block_period: Int,
    proof: Data,
    path: MerklePath,
    value: ByteArray,
  }

  VerifyNonMembership {
    cs: Data,
    cons_state: Data,
    height: Height,
    processed_time: Int,
    processed_height: Int,
    delay_time_period: Int,
    delay_block_period: Int,
    proof: Data,
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
  // Core compares this payload to the exact expected request. Leave decoding
  // to the registered verifier unless an operation needs a field from it.
  proof: Data,
  history_witness: Option<Data>,
}
