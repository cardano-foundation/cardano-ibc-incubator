use aiken/collection/list
use aiken/primitive/int

/// Stable O(n log n) sorting with an already-known input length.
/// Callers must supply the exact count. Equal elements keep their input order.
pub fn sort(
  items: List<a>,
  count: Int,
  compare: fn(a, a) -> Ordering,
) -> List<a> {
  if count <= 1 {
    items
  } else {
    let left_count = count / 2
    let (left, right) = list.span(items, left_count)
    merge(
      sort(left, left_count, compare),
      sort(right, count - left_count, compare),
      compare,
    )
  }
}

fn merge(
  left: List<a>,
  right: List<a>,
  compare: fn(a, a) -> Ordering,
) -> List<a> {
  when left is {
    [] -> right
    [left_head, ..left_tail] ->
      when right is {
        [] -> left
        [right_head, ..right_tail] ->
          if compare(left_head, right_head) == Greater {
            [right_head, ..merge(left, right_tail, compare)]
          } else {
            [left_head, ..merge(left_tail, right, compare)]
          }
      }
  }
}

test stable_merge_sort_handles_empty_and_singleton_lists() {
  and {
    sort([], 0, int.compare) == [],
    sort([3], 1, int.compare) == [3],
  }
}

test stable_merge_sort_handles_reverse_order_and_uneven_halves() {
  sort([5, 4, 3, 2, 1], 5, int.compare) == [1, 2, 3, 4, 5]
}

test stable_merge_sort_preserves_duplicate_input_order() {
  let items = [Pair(2, "a"), Pair(1, "b"), Pair(2, "c"), Pair(1, "d")]
  sort(items, 4, fn(left, right) { int.compare(left.1st, right.1st) }) == [
    Pair(1, "b"), Pair(1, "d"), Pair(2, "a"), Pair(2, "c"),
  ]
}
