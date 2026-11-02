use aiken/builtin
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{Record, max_validators}

// The internal vector is raw40N || hashes32N. Keeping the authenticated
// metadata in place avoids copying it into every intermediate hash row.
fn build_target(
  raw: ByteArray,
  count: Int,
  index: Int,
  previous_key: ByteArray,
  previous_power: Int,
  total: Int,
  hashes: ByteArray,
  order: List<Int>,
  previous_sorted_key: ByteArray,
) -> (Record, ByteArray) {
  if index == count {
    expect order == []
    expect proof.valid_power(total)
    (
      Record {
        root: proof.packed_root(count, hashes, 32, 0),
        count,
        total_power: total,
      },
      builtin.append_bytearray(raw, hashes),
    )
  } else {
    expect [sorted_index, ..remaining] = order
    expect sorted_index >= 0 && sorted_index < count
    let sorted_key = builtin.slice_bytearray(sorted_index * 40, 32, raw)
    expect builtin.less_than_bytearray(previous_sorted_key, sorted_key)
    let offset = index * 40
    let key = builtin.slice_bytearray(offset, 32, raw)
    let power =
      builtin.bytearray_to_integer(
        True,
        builtin.slice_bytearray(offset + 32, 8, raw),
      )
    let hash = proof.leaf_hash(key, power)
    expect
      previous_power == 0 || proof.ordered(
        previous_key,
        previous_power,
        key,
        power,
      )
    build_target(
      raw,
      count,
      index + 1,
      key,
      power,
      total + power,
      builtin.append_bytearray(hashes, hash),
      remaining,
      sorted_key,
    )
  }
}

/// Rows contain only a public key and unsigned big-endian voting power.
/// Their positions and count follow from the exact forty-byte row length.
/// Leaf hashes are computed here and never accepted as part of this witness.
pub fn target(raw: ByteArray, order: List<Int>) -> (Record, ByteArray) {
  let length = bytearray.length(raw)
  expect length % 40 == 0
  let count = length / 40
  expect count > 0 && count <= max_validators
  build_target(raw, count, 0, #"", 0, 0, #"", order, #"")
}
