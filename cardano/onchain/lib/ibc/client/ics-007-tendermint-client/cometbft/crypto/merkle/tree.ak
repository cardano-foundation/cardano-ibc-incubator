use aiken/collection/list
use aiken/math
use aiken/option
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash
use ibc/utils/bits

/// hash_from_byte_slices() computes a Merkle tree where the leaves are the byte slice,
/// in the provided order. It follows RFC-6962.
pub fn hash_from_byte_slices_sha2_256(items: List<ByteArray>) -> ByteArray {
  let len = list.length(items)
  when len is {
    0 -> hash.empty_hash()
    1 -> hash.leaf_hash_opt_sha2_256(list.at(items, 0) |> option.or_else(#""))
    _n -> {
      let k = get_split_point(len)
      let left = hash_from_byte_slices_sha2_256(items |> list.slice(0, k - 1))
      let right =
        hash_from_byte_slices_sha2_256(items |> list.slice(k, len - 1))
      hash.inner_hash_opt_sha2_256(left, right)
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
