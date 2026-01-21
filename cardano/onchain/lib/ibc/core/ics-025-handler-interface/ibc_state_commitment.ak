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
// - Values are hashed first (SHA-256) so leaves commit to fixed-size 32-byte
//   digests. This avoids ambiguity and keeps costs predictable.
// - The "empty value" is represented by an empty bytearray, which produces a
//   well-defined default leaf digest via SHA-256.

use aiken/builtin
use aiken/primitive/bytearray
use ibc/utils/bits

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

/// Hash a leaf from a value digest.
///
/// Leaf hash = sha256(0x00 || value_hash)
pub fn leaf_hash(value_hash: ByteArray) -> ByteArray {
  expect bytearray.length(value_hash) == hash_size_bytes
  // Special-case the default / absent value:
  //
  // - When the committed value is "empty", we treat the leaf as the all-zeros hash.
  // - This makes the empty tree root also be the all-zeros hash, which matches the
  //   existing `empty_ibc_state_root` used throughout the codebase today.
  if value_hash == empty_value_hash {
    empty_hash
  } else {
    builtin.append_bytearray(#[0], value_hash) |> builtin.sha2_256()
  }
}

/// Hash an inner node from two child hashes.
///
/// Inner hash = sha256(0x01 || left || right)
pub fn inner_hash(left: ByteArray, right: ByteArray) -> ByteArray {
  expect bytearray.length(left) == hash_size_bytes
  expect bytearray.length(right) == hash_size_bytes
  // Special-case an entirely empty subtree.
  //
  // If both children are empty, the parent is empty too.
  if left == empty_hash && right == empty_hash {
    empty_hash
  } else {
    builtin.append_bytearray(#[1], left)
      |> builtin.append_bytearray(right)
      |> builtin.sha2_256()
  }
}

/// Read a single bit from a hash, using a stable and well-defined bit order.
///
/// We interpret the first 8 bytes of `sha256(key)` as a 64-bit big-endian number.
/// `bit_index = 0` reads the least significant bit of that number.
fn bit_at(hash: ByteArray, bit_index: Int) -> Int {
  // `merkle_depth_bits` is at most 64, so we only look at the first 8 bytes.
  //
  // We count bytes from the end of that 8-byte segment so that bit 0 starts at
  // the least significant end (byte 7, bit 0).
  let byte_index = 7 - (bit_index / 8)
  let bit_in_byte = bit_index % 8

  let byte = builtin.index_bytearray(hash, byte_index)
  // Shift the selected bit down to position 0 and mask it to 0/1.
  bits.shr(byte, bit_in_byte) % 2
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
  compute_root_go(key_hash, leaf, siblings, 0)
}

fn compute_root_go(
  key_hash: ByteArray,
  current: ByteArray,
  siblings: List<ByteArray>,
  depth: Int,
) -> ByteArray {
  if depth == merkle_depth_bits {
    // Require exactly `merkle_depth_bits` sibling hashes, no more and no less.
    expect siblings == []
    current
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == hash_size_bytes

    let direction_bit = bit_at(key_hash, depth)
    let next =
      if direction_bit == 0 {
        // 0 means "current node is on the left".
        inner_hash(current, sibling)
      } else {
        // 1 means "current node is on the right".
        inner_hash(sibling, current)
      }

    compute_root_go(key_hash, next, rest, depth + 1)
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

  let old_leaf = old_value |> value_hash() |> leaf_hash()
  let computed_old_root = compute_root(key, old_leaf, siblings)
  expect computed_old_root == old_root

  let new_leaf = new_value |> value_hash() |> leaf_hash()
  compute_root(key, new_leaf, siblings)
}
