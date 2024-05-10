use aiken/dict.{Dict}
use aiken/list
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod

pub fn get_consensus_state(
  consensus_states: Dict<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  consensus_states |> dict.get(height)
}

/// get_next_consensus_state() returns the lowest consensus state that is larger than the given height.
pub fn get_next_consensus_state(
  consensus_states: Dict<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  // the list should be sorted by height ascending before
  dict.to_list(consensus_states)
    |> list.reduce(
        None,
        fn(acc, cur) {
          if acc == None && height_mod.compare(cur.1st, height) == Greater {
            Some(cur.2nd)
          } else {
            acc
          }
        },
      )
}

/// get_prev_consensus_state() returns the highest consensus state that is lower than the given height.
pub fn get_prev_consensus_state(
  consensus_states: Dict<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  // the list should be sorted by height ascending before
  dict.to_list(consensus_states)
    |> list.reduce(
        None,
        fn(acc, cur) {
          if height_mod.compare(cur.1st, height) == Less {
            Some(cur.2nd)
          } else {
            acc
          }
        },
      )
}
