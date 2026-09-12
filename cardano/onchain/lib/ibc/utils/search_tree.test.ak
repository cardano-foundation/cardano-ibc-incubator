use aiken/collection/list
use aiken/primitive/int
use ibc/utils/search_tree

test find_rejects_equal_pivot_without_match() {
  let tree = search_tree.from_sorted(list.range(0, 16), 17)
  search_tree.find(
    tree,
    fn(item) { int.compare(8, item) },
    fn(item) { item == -1 },
  ) == None
}

test find_rejects_equal_pivot_in_either_subtree_without_match() {
  let tree = search_tree.from_sorted(list.range(0, 64), 65)
  list.all(
    [16, 49],
    fn(key) {
      search_tree.find(
        tree,
        fn(item) { int.compare(key, item) },
        fn(item) { item == -1 },
      ) == None
    },
  )
}

test find_returns_matching_equal_pivot() {
  let tree = search_tree.from_sorted(list.range(0, 16), 17)
  search_tree.find(
    tree,
    fn(item) { int.compare(8, item) },
    fn(item) { item == 8 },
  ) == Some(8)
}

test find_returns_first_matching_duplicate() {
  let items = list.map(list.range(0, 64), fn(position) { (1, position) })
  let tree = search_tree.from_sorted(items, 65)
  search_tree.find(
    tree,
    fn(item) { int.compare(1, item.1st) },
    fn(item) { item.1st == 1 },
  ) == Some((1, 0))
}
