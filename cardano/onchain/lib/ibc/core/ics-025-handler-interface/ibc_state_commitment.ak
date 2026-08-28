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
// - The witness is the list of sibling hashes along the key's path in the tree.
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
//   empty values remain the all-zero sparse-tree leaf.
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
/// 64 bits is a pragmatic starting point for production-style testing.
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
  // Special-case the default / absent value:
  //
  // - When the committed value is "empty", we treat the leaf as the all-zeros hash.
  // - This makes the empty tree root also be the all-zeros hash, which matches the
  //   existing `empty_ibc_state_root` used throughout the codebase today.
  if value_hash == empty_value_hash {
    empty_hash
  } else {
    builtin.append_bytearray(#[0], key_hash)
      |> builtin.append_bytearray(value_hash)
      |> builtin.sha2_256()
  }
}

/// Hash an inner node from two child hashes.
///
/// Inner hash = sha256(0x01 || left || right)
pub fn inner_hash(left: ByteArray, right: ByteArray) -> ByteArray {
  expect bytearray.length(left) == hash_size_bytes
  expect bytearray.length(right) == hash_size_bytes
  inner_hash_unchecked(left, right, empty_hash)
}

/// Hash children that were already validated or produced by this module.
fn inner_hash_unchecked(
  left: ByteArray,
  right: ByteArray,
  zero_hash: ByteArray,
) -> ByteArray {
  // Special-case an entirely empty subtree.
  //
  // If both children are empty, the parent is empty too.
  if left == zero_hash && right == zero_hash {
    zero_hash
  } else {
    builtin.append_bytearray(#[1], left)
      |> builtin.append_bytearray(right)
      |> builtin.sha2_256()
  }
}

/// Hash an inner node when at least one child is known to be non-empty.
fn inner_hash_nonempty(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(#[1], left)
    |> builtin.append_bytearray(right)
    |> builtin.sha2_256()
}

/// Hash a leaf whose raw value is known to be non-empty.
fn leaf_hash_nonempty(key_hash: ByteArray, value: ByteArray) -> ByteArray {
  builtin.append_bytearray(#[0], key_hash)
    |> builtin.append_bytearray(builtin.sha2_256(value))
    |> builtin.sha2_256()
}

/// Interpret the 64-bit path prefix using the tree's existing bit order.
/// Dividing this integer by two at each level avoids repeated byte indexing
/// and power-of-two shifts. Prefix 2 is an unambiguous terminal sentinel;
/// prefix 3 additionally marks that the committed old root is the second root.
fn path_bits(key_hash: ByteArray) -> Int {
  key_hash
    |> bytearray.take(8)
    |> builtin.cons_bytearray(2, _)
    |> bytearray.to_int_big_endian()
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
  let key_hash = builtin.sha2_256(key)
  compute_root_go(path_bits(key_hash), leaf, siblings)
}

fn compute_root_go(
  remaining_path: Int,
  current: ByteArray,
  siblings: List<ByteArray>,
) -> ByteArray {
  if remaining_path == 2 {
    expect siblings == []
    current
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == hash_size_bytes

    let direction_bit = remaining_path % 2
    let next =
      if direction_bit == 0 {
        // 0 means "current node is on the left".
        inner_hash_unchecked(current, sibling, empty_hash)
      } else {
        // 1 means "current node is on the right".
        inner_hash_unchecked(sibling, current, empty_hash)
      }

    compute_root_go(remaining_path / 2, next, rest)
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
  let path = path_bits(key_hash)
  let zero_hash = builtin.replicate_byte(hash_size_bytes, 0)
  let computed_new_root =
    if new_value == #"" {
      expect old_value != #""
      compute_sparse_update_roots(
        path + 18446744073709551616,
        zero_hash,
        leaf_hash_nonempty(key_hash, old_value),
        siblings,
        old_root,
        zero_hash,
      )
    } else {
      let new_leaf = leaf_hash_nonempty(key_hash, new_value)
      if old_value == #"" {
        compute_sparse_update_roots(
          path,
          zero_hash,
          new_leaf,
          siblings,
          old_root,
          zero_hash,
        )
      } else {
        compute_sparse_update_roots(
          path,
          leaf_hash_nonempty(key_hash, old_value),
          new_leaf,
          siblings,
          old_root,
          zero_hash,
        )
      }
    }

  computed_new_root
}

/// Recompute both roots in one pass. The first side may propagate an empty
/// subtree; the second side is always known to be non-empty.
fn compute_sparse_update_roots(
  remaining_path: Int,
  sparse_current: ByteArray,
  nonempty_current: ByteArray,
  siblings: List<ByteArray>,
  old_root: ByteArray,
  zero_hash: ByteArray,
) -> ByteArray {
  when siblings is {
    [] ->
      if remaining_path == 2 {
        expect sparse_current == old_root
        nonempty_current
      } else {
        expect remaining_path == 3
        expect nonempty_current == old_root
        sparse_current
      }
    [sibling, ..rest] ->
      if remaining_path % 2 == 0 {
        compute_sparse_update_roots(
          remaining_path / 2,
          inner_hash_unchecked(sparse_current, sibling, zero_hash),
          inner_hash_nonempty(nonempty_current, sibling),
          rest,
          old_root,
          zero_hash,
        )
      } else {
        compute_sparse_update_roots(
          remaining_path / 2,
          inner_hash_unchecked(sibling, sparse_current, zero_hash),
          inner_hash_nonempty(sibling, nonempty_current),
          rest,
          old_root,
          zero_hash,
        )
      }
  }
}
