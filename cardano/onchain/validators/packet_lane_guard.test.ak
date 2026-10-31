use aiken/builtin
use cardano/transaction.{OutputReference}
use ibc/apps/transfer/packet_batch.{BatchOperation, LaneInputUpdate}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

test removed_prune_operation_is_rejected() fail {
  let sequence: Data = 1
  let proof_height: Data = Height { revision_number: 1, revision_height: 20 }
  let proof: Data = MerkleProof { proofs: [] }
  let lane: Data =
    LaneInputUpdate {
      input_ref: OutputReference {
        transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
        output_index: 0,
      },
      updates: [],
    }
  let raw = builtin.constr_data(7, [sequence, proof_height, proof, lane])
  expect operation: BatchOperation = raw
  builtin.serialise_data(operation) == builtin.serialise_data(raw)
}
