use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/utils/merge_sort
use ibc/utils/search_tree.{SearchTree}

pub type HeightSet =
  SearchTree<Height>

/// Index retained keys once without reordering persisted histories.
/// Bounded leaves avoid sorting overhead for small histories.
/// Callers supply the exact, already-known key count.
pub fn from_list(keys: List<Height>, count: Int) -> HeightSet {
  search_tree.from_sorted(
    if count <= search_tree.leaf_limit {
      keys
    } else {
      merge_sort.sort(keys, count, height.compare)
    },
    count,
  )
}

pub fn contains(self: HeightSet, key: Height) -> Bool {
  search_tree.find(
    self,
    fn(item) { height.compare(key, item) },
    fn(item) { key == item },
  ) != None
}
