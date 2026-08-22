use aiken/collection/list
use aiken/collection/pairs
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{Expired, Frozen}

/// A single deletion carries one 64-element sparse-tree sibling witness. Two
/// deletions keep the transaction bounded while still guaranteeing progress.
pub const max_terminal_consensus_states_pruned_per_tx: Int = 2

pub fn terminal_prune_count(datum: ClientDatum) -> Int {
  let removable = list.length(datum.state.consensus_states) - 1
  if removable <= max_terminal_consensus_states_pruned_per_tx {
    removable
  } else {
    max_terminal_consensus_states_pruned_per_tx
  }
}

pub fn is_terminal_at(datum: ClientDatum, valid_from: Int) -> Bool {
  when
    client_state.status(
      datum.state.client_state,
      valid_from * 1_000_000,
      datum.state.consensus_states,
    )
  is {
    Frozen | Expired -> True
    _ -> False
  }
}

fn metadata_matches_consensus_states(state: ClientDatumState) -> Bool {
  let consensus_keys = pairs.keys(state.consensus_states)
  and {
    pairs.keys(state.processed_times) == consensus_keys,
    pairs.keys(state.processed_heights) == consensus_keys,
  }
}

fn retained_consensus_states(
  consensus_states: Pairs<Height, ConsensusState>,
) -> Pairs<Height, ConsensusState> {
  expect [latest, ..older] = consensus_states
  [latest, ..list.drop(older, max_terminal_consensus_states_pruned_per_tx)]
}

/// Validate a permissionless, bounded cleanup step for an irrecoverably
/// terminal client. The latest consensus state is always retained for the
/// final status/root check and deleted only by the final reclaim transaction.
pub fn validate_prune_terminal_consensus_states(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  valid_from: Int,
) -> Bool {
  expect [latest, ..older] = input_datum.state.consensus_states
  let latest_height =
    client_state.get_latest_height(input_datum.state.client_state)
  let retained = retained_consensus_states(input_datum.state.consensus_states)
  let retained_heights = pairs.keys(retained)
  let expected_output =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        ..input_datum.state,
        consensus_states: retained,
        processed_times: list.filter(
          input_datum.state.processed_times,
          fn(entry) { list.has(retained_heights, entry.1st) },
        ),
        processed_heights: list.filter(
          input_datum.state.processed_heights,
          fn(entry) { list.has(retained_heights, entry.1st) },
        ),
      },
    }

  and {
    latest.1st == latest_height,
    !list.is_empty(older),
    metadata_matches_consensus_states(input_datum.state),
    is_terminal_at(input_datum, valid_from),
    expected_output == output_datum,
  }
}

/// Final reclaim keeps exactly the latest consensus state and matching delay
/// metadata in the input so HostState can authenticate its last leaf deletion.
pub fn has_exactly_latest_consensus_state(datum: ClientDatum) -> Bool {
  let latest_height = client_state.get_latest_height(datum.state.client_state)
  when datum.state.consensus_states is {
    [Pair(height, _)] -> and {
        height == latest_height,
        when datum.state.processed_times is {
          [Pair(processed_time_height, _)] -> processed_time_height == height
          _ -> False
        },
        when datum.state.processed_heights is {
          [Pair(processed_height_height, _)] ->
            processed_height_height == height
          _ -> False
        },
      }
    _ -> False
  }
}
