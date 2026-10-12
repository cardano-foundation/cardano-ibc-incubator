// IBC State Commitment (Merkle Root) Helpers
//
// This module defines a deterministic way to update `ibc_state_root` on-chain.
//
// Why this exists
// - The HostState UTxO datum contains `ibc_state_root`, which is the commitment
//   a counterparty will use to verify proofs about Cardano's IBC state.
// - If validators accept any new root without checking how it was derived, an
//   operator could commit an arbitrary root and then produce "proofs" against
//   that arbitrary root.
//
// What we enforce
// - Each HostState update transaction carries a small "update witness" per key.
// - The witness contains 64 sibling hashes along the key's path in the tree.
// - An occupied collision position prepends its complete old bucket.
// - With those siblings, a validator can recompute:
//   1) the old root (using the old value)
//   2) the new root (using the new value)
// - The transaction only passes if the recomputed new root equals the root
//   written into the new HostState datum.
//
// Important implementation choices
// - SHA-256 is used everywhere.
// - Keys are hashed with SHA-256 and the first `merkle_depth_bits` bits define
//   the left/right directions from leaf to root.
// - Non-empty leaves commit to both `sha256(key)` and `sha256(value)`, while
//   empty positions remain the all-zero sparse-tree leaf.
// - Colliding full key hashes are sorted in a bucket at their shared position.
// - The "empty value" is represented by an empty bytearray, which produces a
//   well-defined default leaf digest via SHA-256.

use aiken/builtin
use aiken/primitive/bytearray

/// Number of bits taken from `sha256(key)` to define the path.
///
/// This is a trade-off:
/// - More bits => lower collision risk, larger witnesses and higher script cost
/// - Fewer bits => smaller witnesses, higher collision risk
///
/// Colliding routes share a bucket of full key/value hashes at that position.
pub const merkle_depth_bits: Int = 64

/// Hash size used throughout the commitment scheme (SHA-256).
pub const hash_size_bytes: Int = 32

/// The 32-byte "all zeros" hash.
///
/// We use this as the commitment for an entirely empty subtree.
pub const empty_hash: ByteArray =
  #"0000000000000000000000000000000000000000000000000000000000000000"

/// SHA-256 of the empty bytearray.
///
/// This is a stable constant used to detect the "default / absent" value.
pub const empty_value_hash: ByteArray =
  #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

/// Hash the raw value bytes.
///
/// We hash values before placing them in the Merkle tree so that:
/// - leaves always commit to a fixed-size 32-byte digest
/// - the rest of the tree never depends on variable-length concatenations
pub fn value_hash(value: ByteArray) -> ByteArray {
  builtin.sha2_256(value)
}

/// Hash a leaf from a key digest and value digest.
///
/// Non-empty leaf hash = sha256(0x00 || key_hash || value_hash)
pub fn leaf_hash(key_hash: ByteArray, value_hash: ByteArray) -> ByteArray {
  expect bytearray.length(key_hash) == hash_size_bytes
  expect bytearray.length(value_hash) == hash_size_bytes
  leaf_hash_validated(key_hash, value_hash)
}

// Internal hashes come from SHA-256 or exact 32-byte bucket fields.
fn leaf_hash_validated(key_hash, value_hash) {
  // Special-case the default / absent value:
  //
  // - When the committed value is "empty", we treat the leaf as the all-zeros hash.
  // - This makes the empty tree root also be the all-zeros hash, which matches the
  //   existing `empty_ibc_state_root` used throughout the codebase today.
  if value_hash == builtin.sha2_256(#"") {
    builtin.integer_to_bytearray(True, 32, 0)
  } else {
    builtin.cons_bytearray(0, builtin.append_bytearray(key_hash, value_hash))
      |> builtin.sha2_256()
  }
}

/// Hash an inner node from two child hashes.
///
/// Inner hash = sha256(0x01 || left || right)
pub fn inner_hash(left: ByteArray, right: ByteArray) -> ByteArray {
  expect bytearray.length(left) == hash_size_bytes
  expect bytearray.length(right) == hash_size_bytes
  inner_hash_validated(left, right)
}

// Internal callers have already checked each sibling and carry only SHA-256
// outputs or the fixed empty hash. Avoid decoding the same lengths per level.
fn inner_hash_validated(left: ByteArray, right: ByteArray) -> ByteArray {
  // Special-case an entirely empty subtree.
  //
  // If both children are empty, the parent is empty too.
  // Both children are known 32-byte hashes. Integer zero identifies exactly
  // the all-zero digest without repeating its 32-byte literal in the script.
  if builtin.bytearray_to_integer(True, left) == 0 && builtin.bytearray_to_integer(
    True,
    right,
  ) == 0 {
    builtin.integer_to_bytearray(True, 32, 0)
  } else {
    builtin.cons_bytearray(1, builtin.append_bytearray(left, right))
      |> builtin.sha2_256()
  }
}

/// Compute a root from:
/// - a key (which defines the left/right directions via `sha256(key)`)
/// - a leaf hash for that key
/// - a list of sibling hashes (one per tree level)
pub fn compute_root(
  key: ByteArray,
  leaf: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect bytearray.length(leaf) == hash_size_bytes
  root_from_hashes(builtin.sha2_256(key), leaf, siblings)
}

// Hash the key once and retain the size guarantees of native SHA-256 outputs.
// This avoids rechecking/recomputing hashes in the callers that have raw values.
pub fn compute_value_root(
  key: ByteArray,
  value: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  let key_hash = builtin.sha2_256(key)
  root_from_hashes(
    key_hash,
    leaf_hash_validated(key_hash, value_hash(value)),
    siblings,
  )
}

fn root_from_hashes(key_hash, leaf, siblings) {
  let (position, _, path_siblings) =
    witnessed_position(key_hash, leaf, siblings)
  compute_root_go(
    builtin.slice_bytearray(0, 8, key_hash),
    position,
    path_siblings,
    0,
  )
}

fn compute_root_go(
  path: ByteArray,
  current: ByteArray,
  siblings: List<ByteArray>,
  depth: Int,
) -> ByteArray {
  when siblings is {
    [] -> {
      expect depth == merkle_depth_bits
      current
    }
    [sibling, ..rest] -> {
      expect bytearray.length(sibling) == hash_size_bytes
      let next =
        if builtin.read_bit(path, depth) {
          inner_hash_validated(sibling, current)
        } else {
          inner_hash_validated(current, sibling)
        }
      compute_root_go(path, next, rest, depth + 1)
    }
  }
}

/// Apply a single key update witness.
///
/// This enforces the "no arbitrary roots" rule for one key:
/// - recompute the old root from (old value + siblings)
/// - recompute the new root from (new value + siblings)
/// - only accept the update if the old root matches the current commitment
pub fn apply_update(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect bytearray.length(old_root) == hash_size_bytes

  let key_hash = builtin.sha2_256(key)

  let old_leaf = leaf_hash_validated(key_hash, value_hash(old_value))
  let new_value_hash = value_hash(new_value)
  let new_leaf = leaf_hash_validated(key_hash, new_value_hash)
  let (old_position, entries, path_siblings) =
    witnessed_position(key_hash, old_leaf, siblings)
  let new_position =
    if entries == #"" {
      new_leaf
    } else {
      let replacement =
        if new_value_hash == builtin.sha2_256(#"") {
          #""
        } else {
          builtin.append_bytearray(key_hash, new_value_hash)
        }
      bucket_hash(update_bucket(entries, key_hash, replacement))
    }
  let path = builtin.slice_bytearray(0, 8, key_hash)
  let (computed_old, computed_new) =
    updated_roots(path, old_position, new_position, path_siblings, 0)
  expect computed_old == old_root
  computed_new
}

// A descriptor is 0x02 followed by sorted 64-byte key/value hash pairs.
// It precedes the 64 siblings when another key occupies the same position.
// The existing redeemer list can carry it without changing its constructors.
fn witnessed_position(key_hash, expected_leaf, siblings) {
  when siblings is {
    [first, ..rest] ->
      if bytearray.length(first) == hash_size_bytes {
        (expected_leaf, #"", siblings)
      } else {
        let entries = checked_bucket(first, key_hash, expected_leaf)
        (bucket_hash(entries), entries, rest)
      }
    [] -> fail
  }
}

fn checked_bucket(
  encoded: ByteArray,
  key_hash: ByteArray,
  expected_leaf: ByteArray,
) -> ByteArray {
  let size = bytearray.length(encoded)
  expect size >= 65 && ( size - 1 ) % 64 == 0
  expect builtin.index_bytearray(encoded, 0) == 2
  let entries = builtin.slice_bytearray(1, size - 1, encoded)
  // An empty previous key sorts before every full 32-byte key hash.
  let committed_value_hash = check_bucket_entries(entries, key_hash, #"")
  expect leaf_hash_validated(key_hash, committed_value_hash) == expected_leaf
  entries
}

fn check_bucket_entries(entries, key_hash, previous) {
  if entries == #"" {
    builtin.sha2_256(#"")
  } else {
    let entry_key = builtin.slice_bytearray(0, 32, entries)
    let entry_value = builtin.slice_bytearray(32, 32, entries)
    expect
      builtin.slice_bytearray(0, 8, entry_key) == builtin.slice_bytearray(
        0,
        8,
        key_hash,
      )
    expect builtin.less_than_bytearray(previous, entry_key)
    expect entry_value != builtin.sha2_256(#"")
    let rest_value =
      check_bucket_entries(
        builtin.slice_bytearray(64, bytearray.length(entries) - 64, entries),
        key_hash,
        entry_key,
      )
    if entry_key == key_hash {
      entry_value
    } else {
      rest_value
    }
  }
}

// Empty and singleton buckets use the original sparse-tree commitments.
fn bucket_hash(entries) {
  if entries == #"" {
    builtin.integer_to_bytearray(True, 32, 0)
  } else {
    let tag =
      if bytearray.length(entries) == 64 {
        0
      } else {
        2
      }
    builtin.cons_bytearray(tag, entries) |> builtin.sha2_256()
  }
}

// Change only the requested entry. The old bucket must match old_root before
// its successor can become the new root.
fn update_bucket(entries, key_hash, replacement) {
  if entries == #"" {
    replacement
  } else {
    let entry_key = builtin.slice_bytearray(0, 32, entries)
    let entry = builtin.slice_bytearray(0, 64, entries)
    let rest =
      builtin.slice_bytearray(64, bytearray.length(entries) - 64, entries)
    if key_hash == entry_key {
      builtin.append_bytearray(replacement, rest)
    } else if builtin.less_than_bytearray(key_hash, entry_key) {
      builtin.append_bytearray(replacement, entries)
    } else {
      builtin.append_bytearray(
        entry,
        update_bucket(rest, key_hash, replacement),
      )
    }
  }
}

// Both roots follow the same path. Validate each sibling and decode each path
// bit once. Every intermediate node is either a 32-byte constant or SHA-256.
fn updated_roots(
  path: ByteArray,
  old: ByteArray,
  new: ByteArray,
  siblings: List<ByteArray>,
  depth: Int,
) -> (ByteArray, ByteArray) {
  when siblings is {
    [] -> {
      expect depth == merkle_depth_bits
      (old, new)
    }
    [sibling, ..rest] -> {
      expect bytearray.length(sibling) == hash_size_bytes
      let sibling_on_left = builtin.read_bit(path, depth)
      let next_old =
        if sibling_on_left {
          inner_hash_validated(sibling, old)
        } else {
          inner_hash_validated(old, sibling)
        }
      let next_new =
        if sibling_on_left {
          inner_hash_validated(sibling, new)
        } else {
          inner_hash_validated(new, sibling)
        }
      updated_roots(path, next_old, next_new, rest, depth + 1)
    }
  }
}
