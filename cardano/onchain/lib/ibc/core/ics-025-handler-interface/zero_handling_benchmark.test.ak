use aiken/builtin
use aiken/collection/list
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree

const compact = list.repeat(#"", 64)

const full = list.repeat(tree.empty_hash, 64)

const dense =
  list.map(
    list.range(1, 64),
    fn(i) { builtin.sha2_256(builtin.integer_to_bytearray(True, 1, i)) },
  )

const mixed = list.concat(list.repeat(#"", 56), list.take(dense, 8))

// Fixed roots were checked against the unchanged implementation before this change.
const compact_empty_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const compact_old_root =
  #"8d372f0be407888eea75e7a2eade6914df2277981c4f985d49627fa0a7e2d24c"

const compact_new_root =
  #"e482591f95fbaa4fcd89dfe21cd2a6ed131fe5f7b3bdbd11c5e16bc21533980f"

const mixed_empty_root =
  #"95ddfb87f81fa05e8aeca7832f8148596b3c86c3d5f88aa015099953d2b98771"

const mixed_old_root =
  #"a1dc5444aa5aaa9b7760f1b09884b5800b86e49c261b9095da5cb459c198f134"

const mixed_new_root =
  #"548ea2dd051c97c6176d3ec1fd26262737663946f11d6af272ffc14e1903a189"

const dense_empty_root =
  #"a956f9bd430fd90f2ae110588ba780243969cb2e17c5796b494ad6b371bb61a8"

const dense_old_root =
  #"262762958925ee72b851c88665baefea80055fe5cbcf8c29a626124cfe612fee"

const dense_new_root =
  #"cd96114b3fb1d1e85f0a53c02ec5dd4048b76afee02fe07363bb2085297ef4bf"

fn update(before, old_value, new_value, siblings, after) {
  tree.apply_update(before, "zero-benchmark", old_value, new_value, siblings) == after
}

test benchmark_compact_insert() {
  update(compact_empty_root, #"", "new", compact, compact_new_root)
}

test benchmark_compact_replace() {
  update(compact_old_root, "old", "new", compact, compact_new_root)
}

test benchmark_compact_delete() {
  update(compact_old_root, "old", #"", compact, compact_empty_root)
}

test benchmark_compact_empty_noop() {
  update(compact_empty_root, #"", #"", compact, compact_empty_root)
}

test benchmark_full_insert() {
  update(compact_empty_root, #"", "new", full, compact_new_root)
}

test benchmark_full_replace() {
  update(compact_old_root, "old", "new", full, compact_new_root)
}

test benchmark_full_delete() {
  update(compact_old_root, "old", #"", full, compact_empty_root)
}

test benchmark_full_empty_noop() {
  update(compact_empty_root, #"", #"", full, compact_empty_root)
}

test benchmark_mixed_insert() {
  update(mixed_empty_root, #"", "new", mixed, mixed_new_root)
}

test benchmark_mixed_replace() {
  update(mixed_old_root, "old", "new", mixed, mixed_new_root)
}

test benchmark_mixed_delete() {
  update(mixed_old_root, "old", #"", mixed, mixed_empty_root)
}

test benchmark_mixed_empty_noop() {
  update(mixed_empty_root, #"", #"", mixed, mixed_empty_root)
}

test benchmark_dense_insert() {
  update(dense_empty_root, #"", "new", dense, dense_new_root)
}

test benchmark_dense_replace() {
  update(dense_old_root, "old", "new", dense, dense_new_root)
}

test benchmark_dense_delete() {
  update(dense_old_root, "old", #"", dense, dense_empty_root)
}

test benchmark_dense_empty_noop() {
  update(dense_empty_root, #"", #"", dense, dense_empty_root)
}

test benchmark_compact_authenticate() {
  tree.compute_value_root("zero-benchmark", "old", compact) == compact_old_root
}

test benchmark_full_authenticate() {
  tree.compute_value_root("zero-benchmark", "old", full) == compact_old_root
}

test benchmark_mixed_authenticate() {
  tree.compute_value_root("zero-benchmark", "old", mixed) == mixed_old_root
}

test benchmark_dense_authenticate() {
  tree.compute_value_root("zero-benchmark", "old", dense) == dense_old_root
}
