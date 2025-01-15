/// Find the first element satisfying the given predicate, if any.
///
/// ```aiken
/// list.indexed_find([1, 2, 3], fn(x) { x == 2 }) == Some((1, 2))
/// list.indexed_find([4, 5, 6], fn(x) { x == 2 }) == None
/// ```
pub fn indexed_find(self: List<a>, predicate: fn(a) -> Bool) -> Option<(Int, a)> {
  inner_indexed_find(self, 0, predicate)
}

fn inner_indexed_find(
  self: List<a>,
  index: Int,
  predicate: fn(a) -> Bool,
) -> Option<(Int, a)> {
  when self is {
    [] -> None
    [x, ..xs] ->
      if predicate(x) {
        Some((index, x))
      } else {
        inner_indexed_find(xs, index + 1, predicate)
      }
  }
}

test indexed_find_1() {
  indexed_find([1, 2, 3], fn(x) { x == 1 }) == Some((0, 1))
}

test indexed_find_2() {
  indexed_find([1, 2, 3], fn(x) { x > 42 }) == None
}

test indexed_find_3() {
  indexed_find([], fn(_) { True }) == None
}
