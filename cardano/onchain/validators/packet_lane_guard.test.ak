use cardano/transaction.{Mint, OutputReference, Transaction}
use ibc/apps/transfer/packet_batch.{AuthorizedOperation, LaneInputUpdate, Prune}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use packet_lane_guard.{Lane}

test pruning_requires_an_authenticated_lane_input() fail {
  let policy = #"11111111111111111111111111111111111111111111111111111111"
  let ref =
    OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: 0,
    }
  let authorized: Data =
    AuthorizedOperation {
      channel_token: AuthToken { policy_id: policy, name: "channel" },
      operation: Prune {
        sequence: 1,
        proof_height: Height { revision_number: 1, revision_height: 20 },
        proof: MerkleProof { proofs: [] },
        lane: LaneInputUpdate { input_ref: ref, updates: [] },
      },
      history_witness: None,
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      redeemers: [Pair(Mint(policy), authorized)],
    }
  packet_lane_guard.packet_lane_guard.spend(policy, policy, None, Lane, ref, tx)
}
