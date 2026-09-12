use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/multitx/rfc6962_membership

fn values() -> List<ByteArray> {
  [#"00", #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08"]
}

fn take(items: List<a>, count: Int) -> List<a> {
  when items is {
    [] -> []
    [head, ..tail] ->
      if count <= 0 {
        []
      } else {
        [head, ..take(tail, count - 1)]
      }
  }
}

fn audit_path(items: List<ByteArray>, index: Int) -> List<ByteArray> {
  let count = list.length(items)
  if count == 1 {
    []
  } else {
    let split = rfc6962_membership.split_point(count)
    let (left, right) = list.span(items, split)
    if index < split {
      [tree.hash_from_byte_slices_sha2_256(right), ..audit_path(left, index)]
    } else {
      [
        tree.hash_from_byte_slices_sha2_256(left),
        ..audit_path(right, index - split)
      ]
    }
  }
}

test accepts_every_leaf_in_balanced_and_unbalanced_trees() {
  list.all(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    fn(count) {
      let items = take(values(), count)
      let root = tree.hash_from_byte_slices_sha2_256(items)
      items
        |> list.indexed_map(
            fn(index, item) {
              rfc6962_membership.verify(
                root,
                item,
                index,
                count,
                audit_path(items, index),
              )
            },
          )
        |> list.all(fn(valid) { valid })
    },
  )
}

test rejects_wrong_leaf_index_and_tree_size() {
  let items = take(values(), 5)
  let root = tree.hash_from_byte_slices_sha2_256(items)
  and {
    !rfc6962_membership.verify(root, #"ff", 2, 5, audit_path(items, 2)),
    !rfc6962_membership.verify(root, #"02", 1, 5, audit_path(items, 2)),
    !rfc6962_membership.verify(root, #"02", 2, 4, audit_path(items, 2)),
  }
}

test rejects_truncated_and_padded_paths() {
  let items = take(values(), 5)
  let root = tree.hash_from_byte_slices_sha2_256(items)
  let path = audit_path(items, 4)
  expect [_, ..truncated] = path
  and {
    !rfc6962_membership.verify(root, #"04", 4, 5, truncated),
    !rfc6962_membership.verify(root, #"04", 4, 5, [#"00", ..path]),
  }
}
