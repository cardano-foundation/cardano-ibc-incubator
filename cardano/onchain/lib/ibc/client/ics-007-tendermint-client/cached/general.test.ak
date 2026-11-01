use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/general
use ibc/client/ics_007_tendermint_client/cached/packed
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/test_support.{
  FromTarget, Prior, TrustedLeaf, a, b, c, d,
}
use ibc/client/ics_007_tendermint_client/cached/types.{Leaf, Record}
use ibc/client/ics_007_tendermint_client/cached/verify

fn leaves() -> List<Leaf> {
  [
    Leaf { index: 0, pubkey: a, power: 100 },
    Leaf { index: 1, pubkey: b, power: 50 },
    Leaf { index: 2, pubkey: c, power: 25 },
  ]
}

fn references() -> List<TrustedLeaf> {
  [
    FromTarget { target_index: 0, old_power: 100 },
    FromTarget { target_index: 1, old_power: 50 },
    FromTarget { target_index: 2, old_power: 25 },
  ]
}

fn authenticate(refs: List<TrustedLeaf>, signers: List<Leaf>) -> (Record, Int) {
  let target = leaves()
  let (_, hashes) = test_support.target(target)
  test_support.trusted(target, hashes, refs, signers)
}

test target_authenticates_root_count_total_and_packed_native_metadata() {
  let (record, vector) = test_support.target(leaves())
  record == proof.full(leaves()) && bytearray.length(vector) == 216 && and {
    general.key_at_validated(vector, 0) == a,
    general.power_at_validated(vector, 0) == 100,
    builtin.slice_bytearray(120, 32, vector) == proof.leaf_hash(a, 100),
    general.key_at_validated(vector, 1) == b,
    general.power_at_validated(vector, 1) == 50,
    builtin.slice_bytearray(152, 32, vector) == proof.leaf_hash(b, 50),
    general.key_at_validated(vector, 2) == c,
    general.power_at_validated(vector, 2) == 25,
    builtin.slice_bytearray(184, 32, vector) == proof.leaf_hash(c, 25),
  }
}

test compressed_trusted_authentication_matches_complete_target() {
  let (old, overlap) =
    authenticate(
      references(),
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 2, pubkey: c, power: 25 },
      ],
    )
  old == proof.full(leaves()) && overlap == 125
}

test compressed_trusted_authentication_uses_old_signer_power() {
  let (old, overlap) =
    authenticate(
      [
        FromTarget { target_index: 0, old_power: 99 },
        FromTarget { target_index: 1, old_power: 50 },
        FromTarget { target_index: 2, old_power: 25 },
      ],
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 2, pubkey: c, power: 25 },
      ],
    )
  old == proof.full(
    [
      Leaf { index: 0, pubkey: a, power: 99 },
      Leaf { index: 1, pubkey: b, power: 50 },
      Leaf { index: 2, pubkey: c, power: 25 },
    ],
  ) && overlap == 124
}

test compressed_trusted_authentication_supports_reordered_positions() {
  let (old, overlap) =
    authenticate(
      [
        FromTarget { target_index: 1, old_power: 200 },
        FromTarget { target_index: 0, old_power: 100 },
        FromTarget { target_index: 2, old_power: 25 },
      ],
      [Leaf { index: 1, pubkey: b, power: 50 }],
    )
  old == proof.full(
    [
      Leaf { index: 0, pubkey: b, power: 200 },
      Leaf { index: 1, pubkey: a, power: 100 },
      Leaf { index: 2, pubkey: c, power: 25 },
    ],
  ) && overlap == 200
}

test compressed_trusted_authentication_supports_membership_and_count_changes() {
  let (old, overlap) =
    authenticate(
      [
        FromTarget { target_index: 0, old_power: 100 },
        Prior { pubkey: d, power: 60 },
        FromTarget { target_index: 1, old_power: 50 },
        FromTarget { target_index: 2, old_power: 25 },
      ],
      leaves(),
    )
  old == proof.full(
    [
      Leaf { index: 0, pubkey: a, power: 100 },
      Leaf { index: 1, pubkey: d, power: 60 },
      Leaf { index: 2, pubkey: b, power: 50 },
      Leaf { index: 3, pubkey: c, power: 25 },
    ],
  ) && overlap == 175
}

test new_signers_absent_from_old_set_do_not_gain_trusted_power() {
  let (old, overlap) =
    authenticate(
      [
        FromTarget { target_index: 0, old_power: 100 },
        Prior { pubkey: d, power: 60 },
        FromTarget { target_index: 2, old_power: 25 },
      ],
      leaves(),
    )
  old.total_power == 185 && overlap == 125
}

fn maximum_target(index: Int) -> List<Leaf> {
  if index == 256 {
    []
  } else {
    [
      Leaf {
        index,
        pubkey: if index == 255 {
          c
        } else {
          builtin.integer_to_bytearray(True, 32, index)
        },
        power: 256 - index,
      },
      ..maximum_target(index + 1)
    ]
  }
}

test compressed_reference_and_signer_masks_cover_position_255() {
  let all = maximum_target(0)
  let (_, hashes) =
    packed.target(test_support.target_bytes(all), list.range(0, 255))
  let last = Leaf { index: 255, pubkey: c, power: 1 }
  let (old, overlap) =
    test_support.trusted(
      all,
      hashes,
      [FromTarget { target_index: 255, old_power: 1 }],
      [last],
    )
  old == Record {
    root: proof.leaf_hash(last.pubkey, 1),
    count: 1,
    total_power: 1,
  } && overlap == 1
}

test target_rejects_empty_set() fail {
  expect _ = test_support.target([])
}

test target_rejects_duplicate_key_at_different_power() fail {
  expect _ =
    test_support.target(
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 1, pubkey: a, power: 50 },
      ],
    )
}

test target_rejects_noncanonical_power_order() fail {
  expect _ =
    test_support.target(
      [
        Leaf { index: 0, pubkey: a, power: 50 },
        Leaf { index: 1, pubkey: b, power: 100 },
      ],
    )
}

test target_rejects_noncanonical_tied_address_order() fail {
  expect _ =
    test_support.target(
      [
        Leaf { index: 0, pubkey: b, power: 50 },
        Leaf { index: 1, pubkey: a, power: 50 },
      ],
    )
}

test target_rejects_missing_key_position() fail {
  expect _ =
    test_support.target(
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 2, pubkey: b, power: 50 },
      ],
    )
}

test target_rejects_zero_power() fail {
  expect _ = test_support.target([Leaf { index: 0, pubkey: a, power: 0 }])
}

test target_rejects_wrong_key_length() fail {
  expect _ = test_support.target([Leaf { index: 0, pubkey: #"01", power: 100 }])
}

test target_rejects_total_overflow() fail {
  expect _ =
    test_support.target(
      [
        Leaf { index: 0, pubkey: a, power: 1_152_921_504_606_846_975 },
        Leaf { index: 1, pubkey: b, power: 1 },
      ],
    )
}

test compressed_trusted_rejects_empty_old_set() fail {
  expect _ = authenticate([], [])
}

test compressed_trusted_rejects_duplicate_target_reference() fail {
  expect _ =
    authenticate(
      [
        FromTarget { target_index: 0, old_power: 100 },
        FromTarget { target_index: 0, old_power: 50 },
      ],
      [],
    )
}

test compressed_trusted_rejects_duplicate_prior_key() fail {
  expect _ =
    authenticate(
      [Prior { pubkey: d, power: 100 }, Prior { pubkey: d, power: 50 }],
      [],
    )
}

test compressed_trusted_rejects_target_key_hidden_as_prior() fail {
  expect _ = authenticate([Prior { pubkey: a, power: 100 }], [])
}

test compressed_trusted_rejects_byte_index_255_for_three_validators() fail {
  expect _ =
    authenticate([FromTarget { target_index: 255, old_power: 100 }], [])
}

test compressed_trusted_rejects_out_of_range_target_reference() fail {
  expect _ = authenticate([FromTarget { target_index: 3, old_power: 100 }], [])
}

test compressed_trusted_rejects_noncanonical_old_power_order() fail {
  expect _ =
    authenticate(
      [
        FromTarget { target_index: 1, old_power: 50 },
        FromTarget { target_index: 0, old_power: 100 },
      ],
      [],
    )
}

test compressed_trusted_rejects_noncanonical_old_address_tie() fail {
  expect _ =
    authenticate(
      [
        FromTarget { target_index: 1, old_power: 50 },
        FromTarget { target_index: 0, old_power: 50 },
      ],
      [],
    )
}

test compressed_trusted_rejects_zero_old_power() fail {
  expect _ = authenticate([FromTarget { target_index: 0, old_power: 0 }], [])
}

test compressed_trusted_rejects_unsigned_power_above_comet_bound() fail {
  expect _ =
    authenticate(
      [FromTarget { target_index: 0, old_power: 18_446_744_073_709_551_615 }],
      [],
    )
}

test compressed_trusted_rejects_malformed_prior_key() fail {
  expect _ = authenticate([Prior { pubkey: #"01", power: 100 }], [])
}

test compressed_trusted_rejects_old_total_overflow() fail {
  expect _ =
    authenticate(
      [
        FromTarget { target_index: 0, old_power: 1_152_921_504_606_846_975 },
        Prior { pubkey: d, power: 1 },
      ],
      [],
    )
}

test compressed_trusted_rejects_key_substitution() fail {
  expect _ =
    authenticate(references(), [Leaf { index: 0, pubkey: b, power: 100 }])
}

test full_signatures_derive_power_from_packed_target_rows() {
  let (_, vector) = test_support.target(leaves())
  let (power, mask) =
    verify.full_signatures(
      vector,
      3,
      [0],
      [test_support.signature(a)],
      #"",
      #"",
      -1,
      0,
      builtin.integer_to_bytearray(True, 32, 0),
    )
  power == 100 && builtin.read_bit(mask, 0)
}

test compressed_trusted_rejects_duplicate_signers() fail {
  expect _ =
    authenticate(
      references(),
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 0, pubkey: a, power: 100 },
      ],
    )
}

test compressed_trusted_rejects_reordered_signers() fail {
  expect _ =
    authenticate(
      references(),
      [
        Leaf { index: 2, pubkey: c, power: 25 },
        Leaf { index: 0, pubkey: a, power: 100 },
      ],
    )
}

test compressed_trusted_rejects_negative_signer_index() fail {
  expect _ =
    authenticate(references(), [Leaf { index: -1, pubkey: a, power: 100 }])
}

test compressed_trusted_rejects_out_of_range_signer_index() fail {
  expect _ =
    authenticate(references(), [Leaf { index: 3, pubkey: c, power: 25 }])
}

test compressed_trusted_rejects_mismatched_native_hash_vector_length() fail {
  let (_, hashes) = test_support.target(leaves())
  expect _ =
    test_support.trusted(
      leaves(),
      builtin.slice_bytearray(0, 144, hashes),
      references(),
      [],
    )
}

test complete_hash_vector_preserves_uneven_rfc6962_root() {
  test_support.hash_vector_root(
    [proof.leaf_hash(a, 100), proof.leaf_hash(b, 50), proof.leaf_hash(c, 25)],
  ) == proof.full(leaves()).root
}

test complete_hash_vector_rejects_wrong_hash_length() fail {
  expect _ = test_support.hash_vector_root([a, #"01", c])
}

test complete_hash_vector_rejects_empty_set() fail {
  expect _ = test_support.hash_vector_root([])
}

test packed_power_roundtrips_at_native_word_boundaries() {
  list.all(
    [1, 255, 256, 65535, 65536, 1_152_921_504_606_846_975],
    fn(power) {
      let (_, vector) =
        test_support.target([Leaf { index: 0, pubkey: a, power }])
      general.key_at_validated(vector, 0) == a && general.power_at_validated(
        vector,
        0,
      ) == power && builtin.slice_bytearray(40, 32, vector) == proof.leaf_hash(
        a,
        power,
      )
    },
  )
}

test packed_power_is_unsigned_big_endian_eight_bytes() {
  let (_, vector) =
    test_support.target([Leaf { index: 0, pubkey: a, power: 256 }])
  builtin.slice_bytearray(32, 8, vector) == #"0000000000000100"
}

test full_signatures_reject_negative_key_index() fail {
  let (_, vector) = test_support.target(leaves())
  expect _ =
    test_support.full_signatures(
      vector,
      3,
      [Leaf { index: -1, pubkey: a, power: 100 }],
    )
}

test full_signatures_reject_out_of_range_power_index() fail {
  let (_, vector) = test_support.target(leaves())
  expect _ =
    test_support.full_signatures(
      vector,
      3,
      [Leaf { index: 3, pubkey: c, power: 25 }],
    )
}

test trusted_internal_mask_rejects_wrong_width() fail {
  let (_, vector) = test_support.target(leaves())
  expect _ =
    general.trusted_packed(
      3,
      vector,
      test_support.reference_bytes(references()),
      #"01",
    )
}

test packed_root_rejects_wrong_stride_dimensions() fail {
  let (_, vector) = test_support.target(leaves())
  expect _ = proof.packed_root(3, vector, 71, 40)
}

test packed_root_rejects_hash_field_beyond_row() fail {
  let (_, vector) = test_support.target(leaves())
  expect _ = proof.packed_root(3, vector, 72, 41)
}

fn sample_leaves(index: Int) -> List<Leaf> {
  if index == 45 {
    []
  } else {
    [
      Leaf {
        index,
        pubkey: builtin.integer_to_bytearray(True, 32, index + 1),
        power: 45 - index,
      },
      ..sample_leaves(index + 1)
    ]
  }
}

fn sample_refs(index: Int, difference: Int) -> List<TrustedLeaf> {
  if index == 45 {
    []
  } else {
    [
      FromTarget { target_index: index, old_power: 45 - index + difference },
      ..sample_refs(index + 1, difference)
    ]
  }
}

test ordered_target_matches_full_admission_and_native_metadata() {
  let (record, vector) =
    packed.target(test_support.target_bytes(leaves()), [0, 1, 2])
  record == proof.full(leaves()) && bytearray.take(vector, 120) == test_support.target_bytes(
    leaves(),
  )
}

test ordered_target_accepts_nontrivial_pubkey_permutation() {
  let all =
    [
      Leaf { index: 0, pubkey: c, power: 100 },
      Leaf { index: 1, pubkey: a, power: 50 },
      Leaf { index: 2, pubkey: b, power: 25 },
    ]
  let (record, vector) =
    packed.target(test_support.target_bytes(all), [1, 2, 0])
  record == proof.full(all) && general.key_at_validated(vector, 0) == c && general.key_at_validated(
    vector,
    2,
  ) == b
}

test ordered_target_rejects_missing_permutation_entry() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 2])
}

test ordered_target_rejects_extra_permutation_entry() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 1, 2, 2])
}

test ordered_target_rejects_repeated_index_instead_of_omitted_key() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 0, 2])
}

test ordered_target_rejects_repeated_nonadjacent_index() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 2, 0])
}

test ordered_target_rejects_unsorted_key_permutation() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 2, 1])
}

test ordered_target_rejects_negative_index() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [-1, 1, 2])
}

test ordered_target_rejects_out_of_range_index() fail {
  expect _ = packed.target(test_support.target_bytes(leaves()), [0, 1, 3])
}

test ordered_target_rejects_duplicate_key_at_different_power() fail {
  expect _ =
    packed.target(
      test_support.target_bytes(
        [
          Leaf { index: 0, pubkey: a, power: 100 },
          Leaf { index: 1, pubkey: a, power: 50 },
          Leaf { index: 2, pubkey: c, power: 25 },
        ],
      ),
      [0, 1, 2],
    )
}

test ordered_target_still_checks_validator_power_order() fail {
  expect _ =
    packed.target(
      test_support.target_bytes(
        [
          Leaf { index: 0, pubkey: a, power: 50 },
          Leaf { index: 1, pubkey: b, power: 100 },
          Leaf { index: 2, pubkey: c, power: 25 },
        ],
      ),
      [0, 1, 2],
    )
}

test ordered_target_still_checks_validator_address_ties() fail {
  // This is a valid raw-key permutation, but the equal-power validators are
  // reversed in their required address order.
  expect _ =
    packed.target(
      test_support.target_bytes(
        [
          Leaf { index: 0, pubkey: b, power: 50 },
          Leaf { index: 1, pubkey: a, power: 50 },
        ],
      ),
      [1, 0],
    )
}

test ordered_target_rejects_incomplete_row() fail {
  expect _ =
    packed.target(
      bytearray.take(test_support.target_bytes(leaves()), 119),
      [0, 1, 2],
    )
}

test ordered_target_rejects_zero_power() fail {
  expect _ =
    packed.target(
      test_support.target_bytes([Leaf { index: 0, pubkey: a, power: 0 }]),
      [0],
    )
}

test ordered_target_rejects_wrong_key_length() fail {
  expect _ =
    packed.target(
      test_support.target_bytes([Leaf { index: 0, pubkey: #"01", power: 100 }]),
      [0],
    )
}

test ordered_target_rejects_total_overflow() fail {
  expect _ =
    packed.target(
      test_support.target_bytes(
        [
          Leaf { index: 0, pubkey: a, power: 1_152_921_504_606_846_975 },
          Leaf { index: 1, pubkey: b, power: 1 },
        ],
      ),
      [0, 1],
    )
}

test packed_full_set_authenticates_unchanged_and_changed_old_powers() {
  let all = sample_leaves(0)
  let (record, vector) = test_support.target(all)
  let mask =
    builtin.write_bits(
      builtin.integer_to_bytearray(True, 32, 0),
      list.range(0, 33),
      True,
    )
  let (same, same_overlap) =
    general.trusted_packed(
      45,
      vector,
      test_support.reference_bytes(sample_refs(0, 0)),
      mask,
    )
  let (changed, changed_overlap) =
    general.trusted_packed(
      45,
      vector,
      test_support.reference_bytes(sample_refs(0, 1)),
      mask,
    )
  let old_leaves =
    list.map(all, fn(leaf) { Leaf { ..leaf, power: leaf.power + 1 } })
  and {
    record.count == 45,
    record.total_power == 1035,
    bytearray.length(vector) == 3240,
    same == record,
    same_overlap == 969,
    changed == proof.full(old_leaves),
    changed.total_power == 1080,
    changed_overlap == 1003,
  }
}
