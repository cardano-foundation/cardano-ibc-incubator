use aiken/builtin
use aiken/fuzz
use aiken/primitive/bytearray
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits

fn reference_bit_at(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn reference_compute_root(
  key: ByteArray,
  leaf: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  reference_compute_root_go(builtin.sha2_256(key), leaf, siblings, 0)
}

fn reference_compute_root_go(
  key_hash: ByteArray,
  current: ByteArray,
  siblings: List<ByteArray>,
  depth: Int,
) -> ByteArray {
  if depth == ibc_state_commitment.merkle_depth_bits {
    expect siblings == []
    current
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == ibc_state_commitment.hash_size_bytes
    let next =
      if reference_bit_at(key_hash, depth) == 0 {
        ibc_state_commitment.inner_hash(current, sibling)
      } else {
        ibc_state_commitment.inner_hash(sibling, current)
      }
    reference_compute_root_go(key_hash, next, rest, depth + 1)
  }
}

fn reference_apply_update(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  let key_hash = builtin.sha2_256(key)
  let old_leaf =
    ibc_state_commitment.leaf_hash(
      key_hash,
      ibc_state_commitment.value_hash(old_value),
    )
  let new_leaf =
    ibc_state_commitment.leaf_hash(
      key_hash,
      ibc_state_commitment.value_hash(new_value),
    )
  expect reference_compute_root(key, old_leaf, siblings) == old_root
  reference_compute_root(key, new_leaf, siblings)
}

fn patterned_siblings(depth: Int, salt: Int) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    let sibling =
      if ( depth + salt ) % 4 == 0 {
        builtin.sha2_256(bytearray.from_int_big_endian(depth + salt + 1, 8))
      } else {
        ibc_state_commitment.empty_hash
      }
    [sibling, ..patterned_siblings(depth + 1, salt)]
  }
}

fn reference_leaf(key: ByteArray, value: ByteArray) -> ByteArray {
  ibc_state_commitment.leaf_hash(
    builtin.sha2_256(key),
    ibc_state_commitment.value_hash(value),
  )
}

fn zero_siblings(count: Int) -> List<ByteArray> {
  if count == 0 {
    []
  } else {
    [ibc_state_commitment.empty_hash, ..zero_siblings(count - 1)]
  }
}

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

test optimized_compute_root_matches_simple_reference_for_varied_paths() {
  let siblings_1 = patterned_siblings(0, 0)
  let siblings_2 = patterned_siblings(0, 1)
  let key_1 = "clientState/07-tendermint-0"
  let key_2 = #"00010203040506070809"
  and {
    ibc_state_commitment.compute_root(
      key_1,
      reference_leaf(key_1, "old-client"),
      siblings_1,
    ) == reference_compute_root(
      key_1,
      reference_leaf(key_1, "old-client"),
      siblings_1,
    ),
    ibc_state_commitment.compute_root(
      key_2,
      reference_leaf(key_2, "other-value"),
      siblings_2,
    ) == reference_compute_root(
      key_2,
      reference_leaf(key_2, "other-value"),
      siblings_2,
    ),
  }
}

test optimized_nonempty_update_matches_simple_reference() {
  let key = "clientState/07-tendermint-0"
  let siblings = patterned_siblings(0, 2)
  let old_value = "old-client"
  let new_value = "new-client"
  let old_root =
    reference_compute_root(key, reference_leaf(key, old_value), siblings)
  ibc_state_commitment.apply_update(
    old_root,
    key,
    old_value,
    new_value,
    siblings,
  ) == reference_apply_update(old_root, key, old_value, new_value, siblings)
}

test optimized_insertion_matches_simple_reference() {
  let key = #"ffffffff0000000001020304"
  let siblings = patterned_siblings(0, 3)
  let old_root =
    reference_compute_root(key, ibc_state_commitment.empty_hash, siblings)
  ibc_state_commitment.apply_update(
    old_root,
    key,
    #"",
    "inserted-value",
    siblings,
  ) == reference_apply_update(old_root, key, #"", "inserted-value", siblings)
}

test optimized_deletion_matches_simple_reference() {
  let key = "consensusStates/07-tendermint-0/1-42"
  let siblings = patterned_siblings(0, 5)
  let old_value = "stored-consensus-state"
  let old_root =
    reference_compute_root(key, reference_leaf(key, old_value), siblings)
  ibc_state_commitment.apply_update(old_root, key, old_value, #"", siblings) == reference_apply_update(
    old_root,
    key,
    old_value,
    #"",
    siblings,
  )
}

test apply_update_rejects_63_sibling_witness() fail {
  ibc_state_commitment.apply_update(
    ibc_state_commitment.empty_hash,
    "short-witness",
    #"",
    "inserted-value",
    zero_siblings(63),
  ) == #""
}

test apply_update_rejects_65_sibling_witness() fail {
  ibc_state_commitment.apply_update(
    ibc_state_commitment.empty_hash,
    "long-witness",
    #"",
    "inserted-value",
    zero_siblings(65),
  ) == #""
}

test apply_update_rejects_malformed_width_sibling() fail {
  ibc_state_commitment.apply_update(
    ibc_state_commitment.empty_hash,
    "malformed-width-witness",
    #"",
    "inserted-value",
    [builtin.replicate_byte(31, 0), ..zero_siblings(63)],
  ) == #""
}

test prop_optimized_commitment_traversal_matches_reference(seed via fuzz.int()) {
  let magnitude =
    if seed < 0 {
      -seed
    } else {
      seed
    }
  let salt = magnitude % 1_000
  let key =
    bytearray.concat(
      "differential-key/",
      bytearray.from_int_big_endian(magnitude % 18_446_744_073_709_551_616, 8),
    )
  let siblings = patterned_siblings(0, salt)
  let mode = magnitude % 3
  let old_value =
    if mode == 1 {
      #""
    } else {
      "old-value"
    }
  let new_value =
    if mode == 2 {
      #""
    } else {
      "new-value"
    }
  let old_leaf = reference_leaf(key, old_value)
  let old_root = reference_compute_root(key, old_leaf, siblings)
  and {
    ibc_state_commitment.compute_root(key, old_leaf, siblings) == old_root,
    ibc_state_commitment.apply_update(
      old_root,
      key,
      old_value,
      new_value,
      siblings,
    ) == reference_apply_update(old_root, key, old_value, new_value, siblings),
  }
}
