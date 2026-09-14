use aiken/collection/list
use ibc/utils/merge_sort

/// Balanced lookup with bounded leaves, shared by history and validator indexes.
pub type SearchTree<a> {
  Leaf(List<a>)
  Node { left: SearchTree<a>, pivot: a, right: SearchTree<a> }
}

pub const leaf_limit = 16

/// Count must match the list length. Lists larger than the leaf limit must be
/// stably sorted; bounded leaves preserve their input order.
pub fn from_sorted(items: List<a>, count: Int) -> SearchTree<a> {
  if count <= leaf_limit {
    Leaf(items)
  } else {
    let left_count = count / 2
    let (left, right) = merge_sort.split(items, left_count)
    expect [pivot, ..right_tail] = right
    Node {
      left: from_sorted(left, left_count),
      pivot,
      right: from_sorted(right_tail, count - left_count - 1),
    }
  }
}

/// Compare the query with each entry; matches must be true exactly when the
/// comparison is Equal. Native equality avoids full ordering work in leaves.
/// Equal keys return the first sorted entry, even across node partitions.
/// Every returned entry is checked with matches.
pub fn find(
  self: SearchTree<a>,
  compare: fn(a) -> Ordering,
  matches: fn(a) -> Bool,
) -> Option<a> {
  when self is {
    Leaf(items) -> list.find(items, matches)
    Node { left, pivot, right } ->
      when compare(pivot) is {
        Less -> find(left, compare, matches)
        Greater -> find(right, compare, matches)
        Equal ->
          when find(left, compare, matches) is {
            None ->
              if matches(pivot) {
                Some(pivot)
              } else {
                None
              }
            found -> found
          }
      }
  }
}
