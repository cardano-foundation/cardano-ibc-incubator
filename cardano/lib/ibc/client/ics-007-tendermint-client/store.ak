use aiken/pairs
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod

pub fn get_consensus_state(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  pairs.get_first(consensus_states, height)
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
