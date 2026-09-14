use aiken/builtin
use aiken/collection/list
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits

test non_empty_leaf_binds_the_key_hash() {
  let value_digest = ibc_state_commitment.value_hash("same-value")

  let leaf_for_key_a =
    ibc_state_commitment.leaf_hash(builtin.sha2_256("key-a"), value_digest)

  let leaf_for_key_b =
    ibc_state_commitment.leaf_hash(builtin.sha2_256("key-b"), value_digest)

  leaf_for_key_a != leaf_for_key_b
}

test empty_leaf_remains_the_sparse_tree_default() {
  let empty_value_digest = ibc_state_commitment.value_hash("")

  ibc_state_commitment.leaf_hash(
    builtin.sha2_256("any-key"),
    empty_value_digest,
  ) == ibc_state_commitment.empty_hash
}

// Preserve the previous byte/bit traversal as an independent compatibility oracle.
fn legacy_root(key_hash, current, siblings, depth) {
  when siblings is {
    [] -> current
    [sibling, ..rest] -> {
      let byte = builtin.index_bytearray(key_hash, 7 - depth / 8)
      let direction = bits.shr(byte, depth % 8) % 2
      let next =
        if direction == 0 {
          ibc_state_commitment.inner_hash(current, sibling)
        } else {
          ibc_state_commitment.inner_hash(sibling, current)
        }
      legacy_root(key_hash, next, rest, depth + 1)
    }
  }
}

fn siblings(count) {
  if count == 0 {
    []
  } else {
    [
      builtin.sha2_256(builtin.integer_to_bytearray(True, 1, count)),
      ..siblings(count - 1)
    ]
  }
}

test roots_keep_the_existing_bit_order() {
  let witness = siblings(64)
  let leaf = builtin.sha2_256("leaf")
  list.all(
    [
      "", "channelEnds/ports/transfer/channels/channel-0",
      "nextSequenceSend/ports/transfer/channels/channel-0",
      "commitments/ports/transfer/channels/channel-0/sequences/64",
    ],
    fn(key) {
      ibc_state_commitment.compute_root(key, leaf, witness) == legacy_root(
        builtin.sha2_256(key),
        leaf,
        witness,
        0,
      )
    },
  )
}

test rejects_short_witness() fail {
  expect _ =
    ibc_state_commitment.compute_root(
      "key",
      builtin.sha2_256("leaf"),
      siblings(63),
    )
}

test rejects_long_witness() fail {
  expect _ =
    ibc_state_commitment.compute_root(
      "key",
      builtin.sha2_256("leaf"),
      siblings(65),
    )
}

test rejects_wrong_sibling_size() fail {
  expect _ =
    ibc_state_commitment.compute_root(
      "key",
      builtin.sha2_256("leaf"),
      [#"00", ..siblings(63)],
    )
}

test rejects_unauthenticated_old_root() fail {
  expect _ =
    ibc_state_commitment.apply_update(
      ibc_state_commitment.empty_hash,
      "key",
      "old",
      "new",
      siblings(64),
    )
}
