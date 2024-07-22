use aiken/list
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/store as store_mod
use ibc/core/ics_023_vector_commitments/merkle as merkle_mod

fn create_height(revision_height: Int) -> Height {
  height_mod.new_height(0, revision_height)
}

fn create_fake_consensus_state(timestamp: Int) -> ConsensusState {
  ConsensusState {
    timestamp,
    next_validators_hash: "fake next validators hash",
    root: merkle_mod.new_merkle_root("fake root hash"),
  }
}

fn make_fake_consensus_states_store(
  revision_heights: List<Int>,
) -> Pairs<Height, ConsensusState> {
  list.indexed_map(
    revision_heights,
    fn(index, cur) {
      Pair(create_height(cur), create_fake_consensus_state(index))
    },
  )
}

//===========================get_consensus_state===============================
test get_consensus_state_given_existed_height_returns_right_value() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let below_minimum_height = create_height(22)

  let result =
    store_mod.get_consensus_state(consensus_states, below_minimum_height)

  let expected_consensus_state = create_fake_consensus_state(1)
  result == Some(expected_consensus_state)
}

test get_consensus_state_given_non_existed_height_returns_none() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let below_minimum_height = create_height(21)

  let result =
    store_mod.get_consensus_state(consensus_states, below_minimum_height)

  result == None
}

//===========================get_prev_consensus_state===============================
test get_prev_consensus_state_given_below_minimum_height_returns_none() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let below_minimum_height = create_height(9)

  let result =
    store_mod.get_prev_consensus_state(consensus_states, below_minimum_height)

  result == None
}

test get_prev_consensus_state_given_middle_height_returns_right_prev_value() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let middle_height = create_height(25)

  let result =
    store_mod.get_prev_consensus_state(consensus_states, middle_height)

  let expected_consensus_state = create_fake_consensus_state(1)
  result == Some(expected_consensus_state)
}

test get_prev_consensus_state_given_exceed_latest_height_return_latest_value() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let exceed_latest_height = create_height(100)

  let result =
    store_mod.get_prev_consensus_state(consensus_states, exceed_latest_height)

  let expected_consensus_state = create_fake_consensus_state(2)
  result == Some(expected_consensus_state)
}

//===========================get_next_consensus_state===============================
test get_next_consensus_state_given_exceed_latest_height_returns_none() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let exceed_latest_height = create_height(40)

  let result =
    store_mod.get_next_consensus_state(consensus_states, exceed_latest_height)

  result == None
}

test get_next_consensus_state_given_middle_height_returns_right_next_value() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let middle_height = create_height(15)

  let result =
    store_mod.get_next_consensus_state(consensus_states, middle_height)

  let expected_consensus_state = create_fake_consensus_state(1)
  result == Some(expected_consensus_state)
}

test get_next_consensus_state_given_below_minimum_height_returns_first_value() {
  let consensus_states = make_fake_consensus_states_store([10, 22, 39])

  let below_minimum_height = create_height(1)

  let result =
    store_mod.get_next_consensus_state(consensus_states, below_minimum_height)

  let expected_consensus_state = create_fake_consensus_state(0)
  result == Some(expected_consensus_state)
}
