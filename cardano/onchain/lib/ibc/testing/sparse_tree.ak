use aiken/builtin
use aiken/collection/list
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits

// Deterministic fixture-only sparse Merkle tree and proof construction.
fn commitment_key_bit(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn shares_path_above(
  first_hash: ByteArray,
  second_hash: ByteArray,
  depth: Int,
) -> Bool {
  let next_depth = depth + 1
  if next_depth == ibc_state_commitment.merkle_depth_bits {
    True
  } else {
    commitment_key_bit(first_hash, next_depth) == commitment_key_bit(
      second_hash,
      next_depth,
    ) && shares_path_above(first_hash, second_hash, next_depth)
  }
}

fn sparse_subtree_root(
  entries: Pairs<ByteArray, ByteArray>,
  depth: Int,
) -> ByteArray {
  when entries is {
    [] -> ibc_state_commitment.empty_hash
    _ ->
      if depth < 0 {
        expect [Pair(key, value)] = entries
        ibc_state_commitment.leaf_hash(
          builtin.sha2_256(key),
          ibc_state_commitment.value_hash(value),
        )
      } else {
        let left =
          list.filter(
            entries,
            fn(entry) {
              commitment_key_bit(builtin.sha2_256(entry.1st), depth) == 0
            },
          )
        let right =
          list.filter(
            entries,
            fn(entry) {
              commitment_key_bit(builtin.sha2_256(entry.1st), depth) == 1
            },
          )
        ibc_state_commitment.inner_hash(
          sparse_subtree_root(left, depth - 1),
          sparse_subtree_root(right, depth - 1),
        )
      }
  }
}

fn sparse_siblings_go(
  entries: Pairs<ByteArray, ByteArray>,
  target_key: ByteArray,
  target_hash: ByteArray,
  depth: Int,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    let target_bit = commitment_key_bit(target_hash, depth)
    let sibling_entries =
      list.filter(
        entries,
        fn(entry) {
          let entry_hash = builtin.sha2_256(entry.1st)
          entry.1st != target_key && commitment_key_bit(entry_hash, depth) != target_bit && shares_path_above(
            entry_hash,
            target_hash,
            depth,
          )
        },
      )
    [
      sparse_subtree_root(sibling_entries, depth - 1),
      ..sparse_siblings_go(entries, target_key, target_hash, depth + 1)
    ]
  }
}

pub fn siblings(
  entries: Pairs<ByteArray, ByteArray>,
  target_key: ByteArray,
) -> List<ByteArray> {
  sparse_siblings_go(entries, target_key, builtin.sha2_256(target_key), 0)
}

pub fn root(entries: Pairs<ByteArray, ByteArray>) -> ByteArray {
  sparse_subtree_root(entries, ibc_state_commitment.merkle_depth_bits - 1)
}
