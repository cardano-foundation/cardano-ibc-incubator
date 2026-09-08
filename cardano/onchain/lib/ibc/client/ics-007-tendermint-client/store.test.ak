use aiken/collection/list
use aiken/fuzz
use aiken/option
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

fn sorted_neighbors(
  consensus_states: Pairs<Height, ConsensusState>,
  height: Height,
) -> Pair<Option<ConsensusState>, Option<ConsensusState>> {
  let sorted =
    list.sort(
      consensus_states,
      fn(left, right) { height_mod.compare(left.1st, right.1st) },
    )
  Pair(
    store_mod.get_prev_consensus_state(sorted, height),
    store_mod.get_next_consensus_state(sorted, height),
  )
}

fn fuzz_height() -> Fuzzer<Height> {
  fuzz.map2(
    fuzz.int_between(0, 3),
    fuzz.int_between(0, 12),
    height_mod.new_height,
  )
}

fn neighbors(
  states: Pairs<Height, ConsensusState>,
  target: Height,
) -> Pair<Option<ConsensusState>, Option<ConsensusState>> {
  let previous, next <- store_mod.get_consensus_state_neighbors(states, target)
  Pair(
    option.map(previous, fn(entry) { entry.2nd }),
    option.map(next, fn(entry) { entry.2nd }),
  )
}

test neighbors_accept_empty_history() {
  neighbors([], create_height(10)) == Pair(None, None)
}

test neighbors_select_nearest_heights_from_unsorted_history() {
  let states = make_fake_consensus_states_store([39, 10, 22])
  neighbors(states, create_height(25)) == Pair(
    Some(create_fake_consensus_state(2)),
    Some(create_fake_consensus_state(0)),
  )
}

test neighbors_preserve_sorted_search_ties_for_duplicate_heights() {
  let states = make_fake_consensus_states_store([12, 8, 8, 12])
  let result = neighbors(states, create_height(10))
  and {
    result == Pair(
      Some(create_fake_consensus_state(1)),
      Some(create_fake_consensus_state(3)),
    ),
    result == sorted_neighbors(states, create_height(10)),
  }
}

test neighbors_compare_revision_number_before_revision_height() {
  let states =
    [
      Pair(height_mod.new_height(2, 0), create_fake_consensus_state(0)),
      Pair(height_mod.new_height(0, 200), create_fake_consensus_state(1)),
      Pair(height_mod.new_height(1, 99), create_fake_consensus_state(2)),
    ]
  neighbors(states, height_mod.new_height(1, 100)) == Pair(
    Some(create_fake_consensus_state(2)),
    Some(create_fake_consensus_state(0)),
  )
}

// Evaluate the fixed input and old sort-based oracle once, outside the test.
const capacity_neighbor_states =
  make_fake_consensus_states_store(list.reverse(list.range(1, 300)))

const capacity_neighbor_target = create_height(150)

const capacity_neighbor_expected =
  sorted_neighbors(capacity_neighbor_states, capacity_neighbor_target)

test neighbors_match_sorted_search_at_history_capacity() {
  neighbors(capacity_neighbor_states, capacity_neighbor_target) == capacity_neighbor_expected
}

test prop_client_update_neighbors_match_sorted_search(
  scenario via fuzz.both(fuzz.list_between(fuzz_height(), 0, 80), fuzz_height()),
) {
  fuzz.label(@"fuzz.unit.client.history.neighbor_selection")
  let (heights, target) = scenario
  let states =
    list.indexed_map(
      heights,
      fn(index, height) { Pair(height, create_fake_consensus_state(index)) },
    )
  neighbors(states, target) == sorted_neighbors(states, target)
}
