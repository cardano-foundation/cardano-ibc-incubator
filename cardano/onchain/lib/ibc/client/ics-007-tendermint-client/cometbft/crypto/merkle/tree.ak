use aiken/collection/list
use aiken/math
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash
use ibc/utils/bits

/// hash_from_byte_slices() computes a Merkle tree where the leaves are the byte slice,
/// in the provided order. It follows RFC-6962.
pub fn hash_from_byte_slices_sha2_256(items: List<ByteArray>) -> ByteArray {
  let len = list.length(items)
  when len is {
    0 -> hash.empty_hash()
    _ -> hash_non_empty(items, len).1st
  }
}

/// Hash exactly `len` items and return the unconsumed tail. Threading the tail
/// through the recursion preserves the RFC-6962 split without repeatedly
/// measuring and copying sublists.
fn hash_non_empty(
  items: List<ByteArray>,
  len: Int,
) -> (ByteArray, List<ByteArray>) {
  when len is {
    1 -> {
      expect [item, ..rest] = items
      (hash.leaf_hash_opt_sha2_256(item), rest)
    }
    _ -> {
      let k = get_split_point(len)
      let (left_hash, after_left) = hash_non_empty(items, k)
      let (right_hash, rest) = hash_non_empty(after_left, len - k)
      (hash.inner_hash_opt_sha2_256(left_hash, right_hash), rest)
    }
  }
}

/// get_split_point() returns the largest power of 2 less than length.
fn get_split_point(length: Int) -> Int {
  expect length >= 1
  let bit_len = bits.len(length)
  let k = math.pow2(bit_len - 1)
  if k == length {
    k / 2
  } else {
    k
  }
}
