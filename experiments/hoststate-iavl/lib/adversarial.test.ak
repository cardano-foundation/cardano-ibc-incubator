use aiken/builtin
use iavl.{Branch, Empty, Leaf, Pruned, Tree}

fn leaf(key: ByteArray) -> Tree {
  Leaf { key, value_hash: builtin.sha2_256("value"), version: 1 }
}

fn full() -> Tree {
  Branch {
    version: 1,
    left: leaf("a"),
    right: Branch { version: 1, left: leaf("c"), right: leaf("e") },
  }
}

fn partial(h: Int, n: Int) -> Tree {
  Branch {
    version: 1,
    left: leaf("a"),
    right: Pruned {
      height: h,
      size: n,
      version: 1,
      left_hash: iavl.root(leaf("c")),
      right_hash: iavl.root(leaf("e")),
    },
  }
}

test rejects_wrong_old_root() fail {
  expect _ =
    iavl.apply_update(iavl.empty_root, "a", "value", "new", 2, 0, full())
}

test rejects_wrong_old_value() fail {
  expect _ =
    iavl.apply_update(iavl.root(full()), "a", "wrong", "new", 2, 0, full())
}

test rejects_wrong_key_at_valid_rank() fail {
  expect _ =
    iavl.apply_update(iavl.root(full()), "c", "value", "new", 2, 0, full())
}

test rejects_existing_key_as_absent() fail {
  expect _ = iavl.apply_update(iavl.root(full()), "c", "", "new", 2, 0, full())
}

test rejects_nonadjacent_insertion() fail {
  expect _ = iavl.apply_update(iavl.root(full()), "d", "", "new", 2, 0, full())
}

test rejects_successor_instead_of_canonical_predecessor() fail {
  expect _ = iavl.apply_update(iavl.root(full()), "b", "", "new", 2, 1, full())
}

test rejects_negative_rank() fail {
  expect _ =
    iavl.apply_update(iavl.root(full()), "a", "value", "new", 2, -1, full())
}

test rejects_rank_past_end() fail {
  expect _ =
    iavl.apply_update(iavl.root(full()), "e", "value", "new", 2, 3, full())
}

test rejects_forged_subtree_height() fail {
  expect _ =
    iavl.apply_update(
      iavl.root(full()),
      "a",
      "value",
      "new",
      2,
      0,
      partial(2, 2),
    )
}

test rejects_forged_subtree_size() fail {
  expect _ =
    iavl.apply_update(
      iavl.root(full()),
      "a",
      "value",
      "new",
      2,
      0,
      partial(1, 3),
    )
}

test rejects_hidden_required_neighbor() fail {
  expect _ =
    iavl.apply_update(iavl.root(full()), "b", "", "new", 2, 0, partial(1, 2))
}

test accepts_authentic_untouched_subtree() {
  iavl.apply_update(iavl.root(full()), "a", "value", "new", 2, 0, partial(1, 2)) == iavl.apply_update(
    iavl.root(full()),
    "a",
    "value",
    "new",
    2,
    0,
    full(),
  )
}

test rejects_invalid_version() fail {
  expect _ = iavl.apply_update(iavl.empty_root, "a", "", "new", 0, 0, Empty)
}

test node_version_changes_the_commitment() {
  iavl.apply_update(iavl.empty_root, "a", "", "new", 1, 0, Empty) != iavl.apply_update(
    iavl.empty_root,
    "a",
    "",
    "new",
    2,
    0,
    Empty,
  )
}
