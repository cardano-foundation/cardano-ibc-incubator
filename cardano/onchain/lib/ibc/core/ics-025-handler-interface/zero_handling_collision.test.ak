use aiken/collection/list
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree

// Published transitions from tests/ibc-state-commitment/collision-buckets.json.
// Each witness authenticates the old bucket and preserves unrelated entries.
const key = "commitments/ports/transfer/channels/channel-0/sequences/42"

fn compact(siblings) {
  list.map(
    siblings,
    fn(s) {
      if s == tree.empty_hash {
        #""
      } else {
        s
      }
    },
  )
}

fn check_update(old_root, old_value, new_value, siblings, new_root) {
  and {
    tree.apply_update(old_root, key, old_value, new_value, siblings) == new_root,
    tree.apply_update(old_root, key, old_value, new_value, compact(siblings)) == new_root,
    tree.compute_value_root(key, old_value, siblings) == old_root,
    tree.compute_value_root(key, old_value, compact(siblings)) == old_root,
  }
}

const path =
  list.concat(
    list.repeat(tree.empty_hash, 60),
    [
      #"b42cefb1027618c611a14a778d46381f0951bb1dc5112c56abed5158aa677312",
      ..list.repeat(tree.empty_hash, 3)
    ],
  )

test published_insert_collision() {
  check_update(
    #"93afbc048b8185f97e5bfcb4b50ed214f6f440edeccdca95861604d7aa25dfb5",
    #"",
    #"010203",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a",
      ..path
    ],
    #"a5f62817456574aa65fb26c6a672351e662e1b87587d3a15f6381c9ac04d3a8c",
  )
}

test published_update_collision() {
  check_update(
    #"a5f62817456574aa65fb26c6a672351e662e1b87587d3a15f6381c9ac04d3a8c",
    #"010203",
    #"040506",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a16b3df440f3d8fac0d2da528d3327fa34a60823c755dbd112f20ce75404a6646039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      ..path
    ],
    #"26630c5e243469c1257b520f27a721eef8df933d46db2907862a70b24eb20a85",
  )
}

test published_delete_from_three() {
  check_update(
    #"76cc1ebc15ad93018bb8995d8f323374cb01191adfc8a4fc42ca9a45cd7ebf82",
    #"040506",
    #"",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a16b3df440f3d8fac0d2da528d3327fa34a60823c755dbd112f20ce75404a6646787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da8347216b3df440f3d8facffffffffffffffffffffffffffffffffffffffffffffffff5a8814ae66ff07179d2c22381da6221f6fe754e6175c47d7d87846080f0a9715",
      ..path
    ],
    #"36b26a8a4a0bf405c01f164d004125e51cce8e9d98b610a100935f1f02063dcd",
  )
}

test published_reinsert_into_three() {
  check_update(
    #"36b26a8a4a0bf405c01f164d004125e51cce8e9d98b610a100935f1f02063dcd",
    #"",
    #"070809",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a16b3df440f3d8facffffffffffffffffffffffffffffffffffffffffffffffff5a8814ae66ff07179d2c22381da6221f6fe754e6175c47d7d87846080f0a9715",
      ..path
    ],
    #"d43ecfd26b723b351612260b324b4c816e5f6537f94ee5b24b677ea1d22999d0",
  )
}

test published_delete_to_singleton() {
  check_update(
    #"cf528568e33fcec7d8319f31c70dce09aa6d558d35096425db460023e3b526ea",
    #"070809",
    #"",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a16b3df440f3d8fac0d2da528d3327fa34a60823c755dbd112f20ce75404a664666a6757151f8ee55db127716c7e3dce0be8074b64e20eda542e5c1e46ca9c41e",
      ..path
    ],
    #"93afbc048b8185f97e5bfcb4b50ed214f6f440edeccdca95861604d7aa25dfb5",
  )
}

test published_insert_after_collapse() {
  check_update(
    #"93afbc048b8185f97e5bfcb4b50ed214f6f440edeccdca95861604d7aa25dfb5",
    #"",
    #"101112",
    [
      #"0216b3df440f3d8fac000000000000000000000000000000000000000000000000d798d1fac6bd4bb1c11f50312760351013379a0ab6f0a8c0af8a506b96b2525a",
      ..path
    ],
    #"70c9f5093b626064c570e91cfdeefeb4973f29f1170613ff468dbf742ccdafae",
  )
}

test published_ordinary_delete() {
  check_update(
    #"15831bd4e62c37c2a6cf7b640879f317ff1674f122eb502a282da34577af466f",
    #"101112",
    #"",
    path,
    #"0760774413b0ec5c47607aad62956d2634e1aaf8279e5777edf2b386dd4136c7",
  )
}

test public_inner_hash_rejects_compact_empty() fail {
  tree.inner_hash(#"", tree.empty_hash) != #""
}
