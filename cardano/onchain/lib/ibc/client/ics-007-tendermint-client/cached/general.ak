use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  FromTarget, Leaf, Prior, Record, TrustedLeaf, max_validators,
}

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

pub fn key_at(vector: ByteArray, index: Int) -> ByteArray {
  expect index >= 0 && index < bytearray.length(vector) / stride
  key_at_validated(vector, index)
}

pub fn power_at(vector: ByteArray, index: Int) -> Int {
  expect index >= 0 && index < bytearray.length(vector) / stride
  power_at_validated(vector, index)
}

fn columns(
  scratch: ByteArray,
  offset: Int,
  metadata: ByteArray,
  hashes: ByteArray,
) -> ByteArray {
  if offset == bytearray.length(scratch) {
    builtin.append_bytearray(metadata, hashes)
  } else {
    columns(
      scratch,
      offset + stride,
      builtin.append_bytearray(
        metadata,
        builtin.slice_bytearray(offset, 40, scratch),
      ),
      builtin.append_bytearray(
        hashes,
        builtin.slice_bytearray(offset + 40, 32, scratch),
      ),
    )
  }
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

fn target_vector(
  leaves: List<Leaf>,
  index: Int,
  previous_key: ByteArray,
  previous_power: Int,
  total: Int,
  vector: ByteArray,
  check_keys: Bool,
) -> (Record, ByteArray) {
  when leaves is {
    [] -> {
      expect proof.valid_power(total)
      (
        Record {
          root: proof.packed_root(index, vector, stride, 40),
          count: index,
          total_power: total,
        },
        columns(vector, 0, #"", #""),
      )
    }
    [leaf, ..rest] -> {
      expect leaf.index == index
      expect !check_keys || !has_key(vector, leaf.pubkey, stride, 0)
      let hash = proof.leaf_hash(leaf.pubkey, leaf.power)
      expect
        previous_power == 0 || proof.ordered(
          previous_key,
          previous_power,
          leaf.pubkey,
          leaf.power,
        )
      let row =
        builtin.append_bytearray(
          leaf.pubkey,
          builtin.append_bytearray(
            builtin.integer_to_bytearray(True, 8, leaf.power),
            hash,
          ),
        )
      target_vector(
        rest,
        index + 1,
        leaf.pubkey,
        leaf.power,
        total + leaf.power,
        builtin.append_bytearray(vector, row),
        check_keys,
      )
    }
  }
}

/// Establish the complete new set. Native metadata stays in one packed vector
/// for constant-time old-set references and signature membership checks.
pub fn target(leaves: List<Leaf>) -> (Record, ByteArray) {
  let count = list.length(leaves)
  expect count > 0 && count <= max_validators
  target_vector(leaves, 0, #"", 0, 0, #"", True)
}

fn ordered_keys(
  order: List<Int>,
  vector: ByteArray,
  count: Int,
  previous: ByteArray,
) -> Bool {
  when order is {
    [] -> True
    [index, ..rest] -> {
      expect index >= 0 && index < count
      let key = key_at(vector, index)
      expect builtin.less_than_bytearray(previous, key)
      ordered_keys(rest, vector, count, key)
    }
  }
}

/// The index witness lists every target key in strict raw-byte order. Its
/// length, bounds and strict ordering prove a permutation with no repeated
/// indices or keys. Validator power/address ordering is checked independently.
pub fn target_ordered(
  leaves: List<Leaf>,
  order: List<Int>,
) -> (Record, ByteArray) {
  let count = list.length(leaves)
  expect count > 0 && count <= max_validators
  expect list.length(order) == count
  let (record, vector) = target_vector(leaves, 0, #"", 0, 0, #"", False)
  // Empty bytes sort before every valid 32-byte key, including the zero key.
  expect ordered_keys(order, vector, count, #"")
  (record, vector)
}

fn signer_mask(
  target: List<Leaf>,
  signers: List<Leaf>,
  mask: ByteArray,
) -> ByteArray {
  when signers is {
    [] -> mask
    [signer, ..remaining] -> {
      expect [leaf, ..rest] = target
      expect signer.index >= leaf.index
      if signer.index == leaf.index {
        expect signer.pubkey == leaf.pubkey && signer.power == leaf.power
        signer_mask(
          rest,
          remaining,
          builtin.write_bits(mask, [leaf.index], True),
        )
      } else {
        signer_mask(rest, signers, mask)
      }
    }
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

fn pack_references(
  references: List<TrustedLeaf>,
  packed: ByteArray,
) -> ByteArray {
  when references is {
    [] -> packed
    [reference, ..rest] -> {
      let row =
        when reference is {
          FromTarget { target_index, old_power } -> {
            expect
              target_index >= 0 && target_index < max_validators && proof.valid_power(
                old_power,
              )
            builtin.cons_bytearray(
              0,
              builtin.cons_bytearray(
                target_index,
                builtin.integer_to_bytearray(True, 8, old_power),
              ),
            )
          }
          Prior { pubkey, power } -> {
            expect bytearray.length(pubkey) == 32 && proof.valid_power(power)
            builtin.cons_bytearray(
              1,
              builtin.append_bytearray(
                pubkey,
                builtin.integer_to_bytearray(True, 8, power),
              ),
            )
          }
        }
      pack_references(rest, builtin.append_bytearray(packed, row))
    }
  }
}

/// Compatibility wrapper for callers that already have typed references.
pub fn trusted_mask_count(
  target_count: Int,
  vector: ByteArray,
  references: List<TrustedLeaf>,
  verified_mask: ByteArray,
) -> (Record, Int) {
  let count = list.length(references)
  expect count > 0 && count <= max_validators
  trusted_packed(
    target_count,
    vector,
    pack_references(references, #""),
    verified_mask,
  )
}

pub fn trusted_mask(
  target_leaves: List<Leaf>,
  vector: ByteArray,
  references: List<TrustedLeaf>,
  verified_mask: ByteArray,
) -> (Record, Int) {
  trusted_mask_count(
    list.length(target_leaves),
    vector,
    references,
    verified_mask,
  )
}

/// Test/API wrapper. The contract builds the mask during signature checks and
/// uses trusted_packed directly, without materializing old validator records.
pub fn trusted(
  target_leaves: List<Leaf>,
  vector: ByteArray,
  references: List<TrustedLeaf>,
  verified_signers: List<Leaf>,
) -> (Record, Int) {
  let empty = builtin.integer_to_bytearray(True, 32, 0)
  trusted_mask(
    target_leaves,
    vector,
    references,
    signer_mask(target_leaves, verified_signers, empty),
  )
}
