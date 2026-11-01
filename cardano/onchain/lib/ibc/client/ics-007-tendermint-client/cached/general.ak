use aiken/builtin
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{Record, max_validators}

// Native vectors keep all raw key32||powerBE8 metadata first, followed by
// all leaf hashes. The total width remains72bytes per authenticated target.
const stride = 72

/// The caller already checked the index against the authenticated target count.
pub fn key_at_validated(vector: ByteArray, index: Int) -> ByteArray {
  builtin.slice_bytearray(index * 40, 32, vector)
}

/// The caller already checked the index and the complete vector dimensions.
pub fn power_at_validated(vector: ByteArray, index: Int) -> Int {
  builtin.bytearray_to_integer(
    True,
    builtin.slice_bytearray(index * 40 + 32, 8, vector),
  )
}

fn has_key(vector: ByteArray, key: ByteArray, width: Int, offset: Int) -> Bool {
  if offset == bytearray.length(vector) {
    False
  } else if builtin.slice_bytearray(offset, 32, vector) == key {
    True
  } else {
    has_key(vector, key, width, offset + width)
  }
}

fn trusted_bytes(
  references: ByteArray,
  offset: Int,
  vector: ByteArray,
  target_count: Int,
  signers: ByteArray,
  seen: ByteArray,
  prior: ByteArray,
  previous_key: ByteArray,
  previous_power: Int,
  count: Int,
  total: Int,
  overlap: Int,
  hashes: ByteArray,
) -> (Record, Int) {
  let size = bytearray.length(references)
  if offset == size {
    expect count > 0 && proof.valid_power(total)
    (
      Record {
        root: proof.packed_root(count, hashes, 32, 0),
        count,
        total_power: total,
      },
      overlap,
    )
  } else {
    expect offset < size && count < max_validators
    let tag = builtin.index_bytearray(references, offset)
    if tag == 0 {
      expect offset + 10 <= size
      let index = builtin.index_bytearray(references, offset + 1)
      let power =
        builtin.bytearray_to_integer(
          True,
          builtin.slice_bytearray(offset + 2, 8, references),
        )
      expect index < target_count
      expect !builtin.read_bit(seen, index)
      // The row and index bounds imply complete key/power/hash slices.
      let metadata_offset = index * 40
      let key = builtin.slice_bytearray(metadata_offset, 32, vector)
      let new_power =
        builtin.bytearray_to_integer(
          True,
          builtin.slice_bytearray(metadata_offset + 32, 8, vector),
        )
      let old_hash =
        if power == new_power {
          // The identical target power was validated when this vector was built.
          builtin.slice_bytearray(target_count * 40 + index * 32, 32, vector)
        } else {
          // A different old power is validated by its native leaf encoder.
          proof.leaf_hash(key, power)
        }
      expect
        previous_power == 0 || proof.ordered(
          previous_key,
          previous_power,
          key,
          power,
        )
      trusted_bytes(
        references,
        offset + 10,
        vector,
        target_count,
        signers,
        builtin.write_bits(seen, [index], True),
        prior,
        key,
        power,
        count + 1,
        total + power,
        overlap + if builtin.read_bit(signers, index) {
          power
        } else {
          0
        },
        builtin.append_bytearray(hashes, old_hash),
      )
    } else {
      expect tag == 1 && offset + 41 <= size
      let key = builtin.slice_bytearray(offset + 1, 32, references)
      let power =
        builtin.bytearray_to_integer(
          True,
          builtin.slice_bytearray(offset + 33, 8, references),
        )
      expect
        !has_key(prior, key, 32, 0) && !has_key(
          builtin.slice_bytearray(0, target_count * 40, vector),
          key,
          40,
          0,
        )
      let old_hash = proof.leaf_hash(key, power)
      expect
        previous_power == 0 || proof.ordered(
          previous_key,
          previous_power,
          key,
          power,
        )
      trusted_bytes(
        references,
        offset + 41,
        vector,
        target_count,
        signers,
        seen,
        builtin.append_bytearray(prior, key),
        key,
        power,
        count + 1,
        total + power,
        overlap,
        builtin.append_bytearray(hashes, old_hash),
      )
    }
  }
}

/// Parse the complete old set in one pass. Rows are tag0|index1|powerBE8 or
/// tag1|key32|powerBE8. Every byte is consumed and every row contributes one
/// authenticated hash and positive power. The vector and verified mask are
/// internal products of target authentication and signature verification.
pub fn trusted_packed(
  target_count: Int,
  vector: ByteArray,
  references: ByteArray,
  verified_mask: ByteArray,
) -> (Record, Int) {
  expect target_count > 0 && target_count <= max_validators
  expect bytearray.length(vector) == target_count * stride
  expect bytearray.length(verified_mask) == 32
  expect
    bytearray.length(references) > 0 && bytearray.length(references) <= max_validators * 41
  trusted_bytes(
    references,
    0,
    vector,
    target_count,
    verified_mask,
    builtin.integer_to_bytearray(True, 32, 0),
    #"",
    #"",
    0,
    0,
    0,
    0,
    #"",
  )
}
