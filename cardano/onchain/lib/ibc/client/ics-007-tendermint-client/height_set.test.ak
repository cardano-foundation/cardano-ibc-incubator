use aiken/collection/list
use aiken/fuzz
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/height_set

fn fuzz_height() -> Fuzzer<Height> {
  fuzz.map2(
    fuzz.int_between(-3, 3),
    fuzz.int_between(-10, 20),
    height.new_height,
  )
}

fn matches_list_membership(keys: List<Height>, queries: List<Height>) -> Bool {
  let index = height_set.from_list(keys, list.length(keys))
  list.all(
    queries,
    fn(key) { height_set.contains(index, key) == list.has(keys, key) },
  )
}

test prop_height_set_matches_list_membership(
  scenario via fuzz.both(fuzz.list_between(fuzz_height(), 0, 80), fuzz_height()),
) {
  fuzz.label(@"fuzz.unit.client.history.height_membership")
  let (keys, query) = scenario
  matches_list_membership(keys, [query, ..keys])
}

test height_set_empty_and_singleton() {
  let key = height.new_height(0, 1)
  let other_revision = height.new_height(1, 1)
  and {
    matches_list_membership([], [key, other_revision]),
    matches_list_membership([key], [key, other_revision]),
  }
}

test height_set_unsorted_reversed_and_duplicate_keys() {
  let a = height.new_height(0, 1)
  let b = height.new_height(0, 2)
  let c = height.new_height(1, 1)
  let missing = height.new_height(1, 2)
  let queries = [a, b, c, missing]
  list.all(
    [[a, b, c], [c, b, a], [b, a, b, c, a], list.repeat(b, 301)],
    fn(keys) { matches_list_membership(keys, queries) },
  )
}

test height_set_compares_both_signed_unbounded_integer_fields() {
  let large = 340282366920938463463374607431768211456
  let keys =
    [
      height.new_height(-large, large),
      height.new_height(large, -large),
      height.new_height(-1, 1),
      height.new_height(0, 1),
      height.new_height(1, -1),
    ]
  matches_list_membership(
    keys,
    [
      height.new_height(-large, large + 1),
      height.new_height(large + 1, -large),
      height.new_height(1, 1),
      ..keys
    ],
  )
}
