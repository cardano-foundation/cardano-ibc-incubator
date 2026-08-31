use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/core/ics_025_handler_interface/compact_sparse_path_prototype.{
  CompactSparsePath,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment

const first_sibling =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const last_sibling =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

test all_default_path_expands_to_the_existing_64_level_witness() {
  let path =
    CompactSparsePath { non_default_bitmap: #"0000000000000000", siblings: #"" }
  expect Some(expanded) = compact_sparse_path_prototype.expand(path)

  and {
    list.length(expanded) == ibc_state_commitment.merkle_depth_bits,
    list.all(
      expanded,
      fn(sibling) { sibling == ibc_state_commitment.empty_hash },
    ),
  }
}

test non_default_siblings_preserve_tree_level_order() {
  // Bit zero and bit 63 are set.
  let path =
    CompactSparsePath {
      non_default_bitmap: #"0100000000000080",
      siblings: bytearray.concat(first_sibling, last_sibling),
    }
  expect Some(expanded) = compact_sparse_path_prototype.expand(path)
  expect Some(first) = list.at(expanded, 0)
  expect Some(last) = list.at(expanded, 63)

  and {
    first == first_sibling,
    last == last_sibling,
    list.length(expanded) == 64,
  }
}

test compact_path_reconstructs_the_same_host_state_root() {
  let key = "clients/07-tendermint-0/clientState"
  let leaf =
    ibc_state_commitment.leaf_hash(
      builtin.sha2_256(key),
      ibc_state_commitment.value_hash("client-state"),
    )
  let full = list.repeat(ibc_state_commitment.empty_hash, 64)
  expect Some(expanded) =
    compact_sparse_path_prototype.expand(
      CompactSparsePath {
        non_default_bitmap: #"0000000000000000",
        siblings: #"",
      },
    )

  ibc_state_commitment.compute_root(key, leaf, expanded) == ibc_state_commitment.compute_root(
    key,
    leaf,
    full,
  )
}

test compact_path_rejects_non_canonical_or_incomplete_data() {
  and {
    compact_sparse_path_prototype.expand(
      CompactSparsePath { non_default_bitmap: #"00", siblings: #"" },
    ) == None,
    compact_sparse_path_prototype.expand(
      CompactSparsePath {
        non_default_bitmap: #"0100000000000000",
        siblings: #"",
      },
    ) == None,
    compact_sparse_path_prototype.expand(
      CompactSparsePath {
        non_default_bitmap: #"0000000000000000",
        siblings: first_sibling,
      },
    ) == None,
    compact_sparse_path_prototype.expand(
      CompactSparsePath {
        non_default_bitmap: #"0100000000000000",
        siblings: ibc_state_commitment.empty_hash,
      },
    ) == None,
  }
}
