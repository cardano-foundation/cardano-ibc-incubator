use aiken/collection/list
use aiken/collection/pairs
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_reclamation
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

fn consensus(timestamp: Int) -> ConsensusState {
  ConsensusState {
    timestamp,
    next_validators_hash: "validators",
    root: MerkleRoot { hash: "root" },
  }
}

fn client_datum(frozen: Bool, state_count: Int) -> ClientDatum {
  let h1 = Height { revision_number: 1, revision_height: 1 }
  let h2 = Height { revision_number: 1, revision_height: 2 }
  let h3 = Height { revision_number: 1, revision_height: 3 }
  let states =
    if state_count == 1 {
      [Pair(h3, consensus(0))]
    } else {
      [Pair(h3, consensus(0)), Pair(h2, consensus(0)), Pair(h1, consensus(0))]
    }
  let keys = pairs.keys(states)
  ClientDatum {
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-1",
        trust_level: unchecked_rational.from_int(1),
        trusting_period: 1,
        unbonding_period: 2,
        max_clock_drift: 1,
        frozen_height: if frozen {
          h1
        } else {
          height.zero_height()
        },
        latest_height: h3,
        proof_specs: [],
      },
      consensus_states: states,
      processed_times: list.map(keys, fn(h) { Pair(h, 0) }),
      processed_heights: list.map(keys, fn(h) { Pair(h, 0) }),
    },
    token: AuthToken { policy_id: "policy", name: "client" },
  }
}

test terminal_prune_is_bounded_and_retains_latest() {
  let input = client_datum(True, 3)
  expect [latest, ..] = input.state.consensus_states
  let output =
    ClientDatum {
      ..input,
      state: ClientDatumState {
        ..input.state,
        consensus_states: [latest],
        processed_times: list.filter(
          input.state.processed_times,
          fn(entry) { entry.1st == latest.1st },
        ),
        processed_heights: list.filter(
          input.state.processed_heights,
          fn(entry) { entry.1st == latest.1st },
        ),
      },
    }

  and {
    client_reclamation.terminal_prune_count(input) == 2,
    client_reclamation.validate_prune_terminal_consensus_states(
      input,
      output,
      1,
    ),
    client_reclamation.has_exactly_latest_consensus_state(output),
  }
}

test active_client_cannot_use_terminal_prune() {
  let input = client_datum(False, 3)
  // At zero milliseconds the latest timestamp has not expired.
  !client_reclamation.is_terminal_at(input, 0)
}

test final_reclaim_shape_rejects_more_than_latest() {
  !client_reclamation.has_exactly_latest_consensus_state(client_datum(True, 3))
}
