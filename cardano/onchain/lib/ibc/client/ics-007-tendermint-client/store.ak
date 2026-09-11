use aiken/collection/list
use aiken/collection/pairs
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod

pub fn get_consensus_state(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  when consensus_states is {
    [] -> None
    [Pair(stored_height, state), ..rest] ->
      if height_mod.equal(stored_height, height) {
        Some(state)
      } else {
        get_consensus_state(rest, height)
      }
  }
}

/// Find the nearest lower and higher heights without sorting the store.
/// Equal-height ties preserve sort-then-search behavior: the first input wins
/// below the target and the last input wins above it.
pub fn get_consensus_state_neighbors(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
  return: fn(
    Option<Pair<Height, ConsensusState>>,
    Option<Pair<Height, ConsensusState>>,
  ) ->
    result,
) -> result {
  list.foldl2(
    consensus_states,
    None,
    None,
    fn(entry, previous, next, continue) {
      let ordering = height_mod.compare(entry.1st, height)
      continue(
        if ordering == Less {
          nearer(previous, entry, False)
        } else {
          previous
        },
        if ordering == Greater {
          nearer(next, entry, True)
        } else {
          next
        },
      )
    },
    return,
  )
}

fn nearer(
  candidate: Option<Pair<Height, ConsensusState>>,
  entry: Pair<Height, ConsensusState>,
  next: Bool,
) -> Option<Pair<Height, ConsensusState>> {
  let replace =
    when candidate is {
      None -> True
      Some(current) ->
        height_mod.compare(entry.1st, current.1st) == Greater != next
    }
  if replace {
    Some(entry)
  } else {
    candidate
  }
}

/// get_next_consensus_state() returns the lowest consensus state that is larger than the given height.
/// consensus_states must be sorted in ascending order before
pub fn get_next_consensus_state(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  pairs.foldl(
    consensus_states,
    None,
    fn(key, val, acc) {
      if acc == None && height_mod.compare(key, height) == Greater {
        Some(val)
      } else {
        acc
      }
    },
  )
}

/// get_prev_consensus_state() returns the highest consensus state that is lower than the given height.
/// consensus_states must be sorted in ascending order before
pub fn get_prev_consensus_state(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  pairs.foldr(
    consensus_states,
    None,
    fn(key, val, acc) {
      if acc == None && height_mod.compare(key, height) == Less {
        Some(val)
      } else {
        acc
      }
    },
  )
}
