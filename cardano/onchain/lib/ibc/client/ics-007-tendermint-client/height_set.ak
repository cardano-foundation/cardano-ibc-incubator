use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/utils/merge_sort

pub type HeightSet {
  Leaf(List<Height>)
  Node { left: HeightSet, key: Height, right: HeightSet }
}

const leaf_limit = 16

/// Index only the retained keys, without reordering any persisted history.
/// Merge sort bounds construction at O(n log n) even for unordered or duplicate
/// keys. The balanced tree then bounds each metadata lookup at O(log n).
/// Leaves use at most 16 comparisons to avoid tiny subtrees and small-history
/// sorting overhead.
/// Callers supply the exact, already-known number of keys.
pub fn from_list(keys: List<Height>, count: Int) -> HeightSet {
  if count <= leaf_limit {
    Leaf(keys)
  } else {
    from_sorted(merge_sort.sort(keys, count, height.compare), count)
  }
}

pub fn contains(self: HeightSet, key: Height) -> Bool {
  when self is {
    Leaf(keys) -> list.has(keys, key)
    Node { left, key: pivot, right } ->
      contains(
        if height.compare(key, pivot) == Less {
          left
        } else {
          right
        },
        key,
      )
  }
}

fn from_sorted(keys: List<Height>, count: Int) -> HeightSet {
  if count <= leaf_limit {
    Leaf(keys)
  } else {
    let left_count = count / 2
    let (left, right) = list.span(keys, left_count)
    // The separator remains in the right subtree, including duplicate keys.
    expect [key, ..] = right
    Node {
      left: from_sorted(left, left_count),
      key,
      right: from_sorted(right, count - left_count),
    }
  }
}
