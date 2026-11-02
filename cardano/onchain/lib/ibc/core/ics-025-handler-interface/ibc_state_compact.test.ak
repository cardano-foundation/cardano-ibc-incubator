use aiken/collection/list
use ibc/core/ics_025_handler_interface/ibc_state_commitment as commitment

const a = #"1111111111111111111111111111111111111111111111111111111111111111"

const b = #"2222222222222222222222222222222222222222222222222222222222222222"

test compact_paths_preserve_both_update_roots() {
  let full = [a, ..list.concat(list.repeat(commitment.empty_hash, 62), [b])]
  let compact = [a, ..list.concat(list.repeat(#"", 62), [b])]
  let old = commitment.compute_value_root("client", "old", full)
  commitment.apply_update(old, "client", "old", "new", compact) == commitment.apply_update(
    old,
    "client",
    "old",
    "new",
    full,
  )
}

test compact_empty_path_preserves_root() {
  commitment.compute_value_root("client", "old", list.repeat(#"", 64)) == commitment.compute_value_root(
    "client",
    "old",
    list.repeat(commitment.empty_hash, 64),
  )
}

test compact_rejects_unused_hash() fail {
  expect _ =
    commitment.compute_value_root(
      "client",
      "old",
      list.concat(list.repeat(#"", 64), [a]),
    )
}

test compact_rejects_missing_hash() fail {
  expect _ =
    commitment.compute_value_root("client", "old", list.repeat(#"", 63))
}

test compact_rejects_short_hash() fail {
  expect _ =
    commitment.compute_value_root(
      "client",
      "old",
      [#"11", ..list.repeat(#"", 63)],
    )
}

test compact_bucket_path_preserves_collision_root() {
  let bucket =
    #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a"
  commitment.compute_value_root(
    "commitments/ports/transfer/channels/channel-0/sequences/42",
    #"",
    [
      bucket,
      ..list.concat(
        list.repeat(#"", 60),
        [
          #"b42cefb1027618c611a14a778d46381f0951bb1dc5112c56abed5158aa677312",
          #"", #"", #"",
        ],
      )
    ],
  ) == #"93afbc048b8185f97e5bfcb4b50ed214f6f440edeccdca95861604d7aa25dfb5"
}

test compact_rejects_an_extra_level() fail {
  expect _ =
    commitment.compute_value_root("client", "old", list.repeat(#"", 65))
}
