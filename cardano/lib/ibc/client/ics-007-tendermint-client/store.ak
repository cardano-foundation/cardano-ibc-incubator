use aiken/dict.{Dict}
use aiken/list
use aiken/option
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}

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
  let cons_states_list = consensus_states |> dict.to_list()
  let cons_state_at_given_height = get_consensus_state(consensus_states, height)
  if option.is_some(cons_state_at_given_height) {
    expect Some(index_of_cons_state_at_given_height) =
      cons_states_list
        |> list.index_of(
             (
               height,
               option.or_else(
                 cons_state_at_given_height,
                 consensus_state.null_consensus_state(),
               ),
             ),
           )
    if index_of_cons_state_at_given_height < list.length(cons_states_list) - 1 {
      expect Some(next) =
        list.at(cons_states_list, index_of_cons_state_at_given_height + 1)
      Some(next.2nd)
    } else {
      None
    }
  } else {
    None
  }
}

/// get_prev_consensus_state() returns the highest consensus state that is lower than the given height.
pub fn get_prev_consensus_state(
  consensus_states: Dict<Height, ConsensusState>,
  height: Height,
) -> Option<ConsensusState> {
  let cons_states_list = consensus_states |> dict.to_list()
  let cons_state_at_given_height = get_consensus_state(consensus_states, height)
  if option.is_some(cons_state_at_given_height) {
    expect Some(index_of_cons_state_at_given_height) =
      cons_states_list
        |> list.index_of(
             (
               height,
               option.or_else(
                 cons_state_at_given_height,
                 consensus_state.null_consensus_state(),
               ),
             ),
           )
    if index_of_cons_state_at_given_height > 0 {
      expect Some(prev) =
        list.at(cons_states_list, index_of_cons_state_at_given_height - 1)
      Some(prev.2nd)
    } else {
      None
    }
  } else {
    None
  }
}
