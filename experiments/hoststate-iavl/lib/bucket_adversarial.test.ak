use aiken/builtin
use aiken/collection/list
use bucket.{CompressedWitness, Occupant, Step, Witness}
use sparse_baseline

const a = #"0000000000000000000000000000000000000000000000000000000000000000"

const b = #"0000000000000000800000000000000000000000000000000000000000000000"

const c = #"0000000000000000000000000000000000000000000000000000000000000001"

fn leaf(key: ByteArray) -> ByteArray {
  sparse_baseline.leaf_hash(key, builtin.sha2_256("value"))
}

fn outer(hash: ByteArray, remaining: Int) -> ByteArray {
  if remaining == 0 {
    hash
  } else {
    outer(
      sparse_baseline.inner_hash(hash, sparse_baseline.empty_hash),
      remaining - 1,
    )
  }
}

fn witness(occupant: Option<Occupant>, path: List<Step>) -> Witness {
  Witness {
    occupant,
    bucket_path: path,
    outer_siblings: list.repeat(sparse_baseline.empty_hash, 64),
  }
}

test inserts_at_last_digest_bit() {
  let proof =
    witness(
      Some(Occupant { key_hash: a, value_hash: builtin.sha2_256("value") }),
      [],
    )
  bucket.apply_digest_update(outer(leaf(a), 64), c, "", "value", proof) == outer(
    bucket.branch_hash(191, leaf(a), leaf(c)),
    64,
  )
}

test deleting_one_of_two_colliding_keys_restores_singleton() {
  let proof = witness(None, [Step { bit: 0, sibling: leaf(b) }])
  bucket.apply_digest_update(
    outer(bucket.branch_hash(0, leaf(a), leaf(b)), 64),
    a,
    "value",
    "",
    proof,
  ) == outer(leaf(b), 64)
}

test absent_colliding_key_has_a_valid_exclusion_proof() {
  let proof =
    witness(
      Some(Occupant { key_hash: a, value_hash: builtin.sha2_256("value") }),
      [],
    )
  let root = outer(leaf(a), 64)
  bucket.apply_digest_update(root, c, "", "", proof) == root
}

test rejects_existing_key_claimed_absent() fail {
  let proof =
    witness(
      Some(Occupant { key_hash: a, value_hash: builtin.sha2_256("value") }),
      [],
    )
  expect _ = bucket.apply_digest_update(outer(leaf(a), 64), a, "", "new", proof)
}

test rejects_wrong_old_value() fail {
  expect _ =
    bucket.apply_digest_update(
      outer(leaf(a), 64),
      a,
      "wrong",
      "new",
      witness(None, []),
    )
}

test rejects_forged_occupant() fail {
  let proof =
    witness(
      Some(Occupant { key_hash: b, value_hash: builtin.sha2_256("value") }),
      [],
    )
  expect _ = bucket.apply_digest_update(outer(leaf(a), 64), c, "", "new", proof)
}

test rejects_wrong_branch_bit() fail {
  expect _ =
    bucket.apply_digest_update(
      outer(bucket.branch_hash(0, leaf(a), leaf(b)), 64),
      a,
      "value",
      "new",
      witness(None, [Step { bit: 1, sibling: leaf(b) }]),
    )
}

test rejects_repeated_branch_bit() fail {
  expect _ =
    bucket.apply_digest_update(
      a,
      a,
      "value",
      "new",
      witness(
        None,
        [Step { bit: 0, sibling: leaf(b) }, Step { bit: 0, sibling: leaf(c) }],
      ),
    )
}

test rejects_out_of_range_branch_bit() fail {
  expect _ =
    bucket.apply_digest_update(
      a,
      a,
      "value",
      "new",
      witness(None, [Step { bit: 192, sibling: leaf(b) }]),
    )
}

test rejects_opaque_empty_bucket_child() fail {
  expect _ =
    bucket.apply_digest_update(
      a,
      a,
      "value",
      "new",
      witness(None, [Step { bit: 0, sibling: sparse_baseline.empty_hash }]),
    )
}

test rejects_wrong_outer_route() fail {
  let proof =
    witness(
      Some(
        Occupant {
          key_hash: builtin.sha2_256("another route"),
          value_hash: builtin.sha2_256("value"),
        },
      ),
      [],
    )
  expect _ = bucket.apply_digest_update(outer(leaf(a), 64), c, "", "new", proof)
}

test rejects_missing_nonzero_bitmap_entry() fail {
  expect _ =
    bucket.apply_compressed_update(
      a,
      "key",
      "",
      "value",
      CompressedWitness {
        occupant: None,
        bucket_path: [],
        bitmap: 1,
        outer_siblings: [],
      },
    )
}

test rejects_extra_bitmap_entry() fail {
  expect _ =
    bucket.apply_compressed_update(
      a,
      "key",
      "",
      "value",
      CompressedWitness {
        occupant: None,
        bucket_path: [],
        bitmap: 0,
        outer_siblings: [leaf(a)],
      },
    )
}

test rejects_explicit_zero_bitmap_entry() fail {
  expect _ =
    bucket.apply_compressed_update(
      a,
      "key",
      "",
      "value",
      CompressedWitness {
        occupant: None,
        bucket_path: [],
        bitmap: 1,
        outer_siblings: [sparse_baseline.empty_hash],
      },
    )
}

test rejects_65_bit_bitmap() fail {
  expect _ =
    bucket.apply_compressed_update(
      a,
      "key",
      "",
      "value",
      CompressedWitness {
        occupant: None,
        bucket_path: [],
        bitmap: 18_446_744_073_709_551_616,
        outer_siblings: [],
      },
    )
}
