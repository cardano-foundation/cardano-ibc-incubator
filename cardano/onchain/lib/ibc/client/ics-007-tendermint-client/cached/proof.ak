use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, PowerChange, Record, max_validators,
}
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash
use ibc/client/ics_007_tendermint_client/multitx/types.{max_total_voting_power} as session_types

pub fn valid_power(power: Int) -> Bool {
  power > 0 && power <= max_total_voting_power
}

pub fn address(pubkey: ByteArray) -> ByteArray {
  builtin.sha2_256(pubkey) |> bytearray.take(20)
}

// Powers are positive and bounded before encoding. Each step emits the low
// seven bits and recurses on the remaining unsigned value.
fn positive_varint(value: Int) -> ByteArray {
  if value < 128 {
    builtin.cons_bytearray(value, #"")
  } else {
    builtin.cons_bytearray(value % 128 + 128, positive_varint(value / 128))
  }
}

/// Positive Ed25519 SimpleValidator encoding. The key length and protobuf
/// field tags are fixed. Only the voting-power varint changes between roots.
pub fn leaf_bytes(pubkey: ByteArray, power: Int) -> ByteArray {
  expect bytearray.length(pubkey) == 32 && valid_power(power)
  builtin.append_bytearray(
    builtin.append_bytearray(#"0a220a20", pubkey),
    builtin.cons_bytearray(16, positive_varint(power)),
  )
}

pub fn leaf_hash(pubkey: ByteArray, power: Int) -> ByteArray {
  leaf_bytes(pubkey, power) |> hash.leaf_hash_opt_sha2_256()
}

pub fn ordered(
  left_key: ByteArray,
  left: Int,
  right_key: ByteArray,
  right: Int,
) -> Bool {
  left > right || left == right && bytearray.compare(
    address(left_key),
    address(right_key),
  ) == Less
}

fn split(count: Int, pivot: Int) -> Int {
  if pivot * 2 < count {
    split(count, pivot * 2)
  } else {
    pivot
  }
}

/// An omitted subtree consumes exactly one hash. A covered leaf consumes
/// exactly one indexed value. Tree shape comes only from the authenticated
/// count, never from witness flags or an independently supplied proof shape.
fn walk(
  start: Int,
  count: Int,
  leaves: List<Leaf>,
  siblings: List<ByteArray>,
  finish: fn(ByteArray, List<Leaf>, List<ByteArray>) -> ByteArray,
) -> ByteArray {
  let covered =
    when leaves is {
      [leaf, ..] -> leaf.index < start + count
      [] -> False
    }
  if covered {
    expect [leaf, ..rest] = leaves
    expect leaf.index >= start
    if count == 1 {
      finish(leaf_hash(leaf.pubkey, leaf.power), rest, siblings)
    } else {
      let pivot = split(count, 1)
      walk(
        start,
        pivot,
        leaves,
        siblings,
        fn(left, after_left, remaining) {
          walk(
            start + pivot,
            count - pivot,
            after_left,
            remaining,
            fn(right, after_right, tail) {
              finish(
                hash.inner_hash_opt_sha2_256(left, right),
                after_right,
                tail,
              )
            },
          )
        },
      )
    }
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == 32
    finish(sibling, leaves, rest)
  }
}

pub fn root(
  count: Int,
  leaves: List<Leaf>,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect count > 0 && count <= max_validators
  expect leaves != []
  walk(
    0,
    count,
    leaves,
    siblings,
    fn(computed, remaining, tail) {
      expect remaining == [] && tail == []
      computed
    },
  )
}

/// Full admission establishes the count and denominator from every leaf.
/// Canonical power/address ordering rejects repeated identities at equal power.
/// Explicit public-key uniqueness also rejects the same key at different power.
pub fn full(leaves: List<Leaf>) -> Record {
  let count = list.length(leaves)
  expect count > 0 && count <= max_validators
  expect full_order(leaves, 0, [])
  let total_power =
    list.foldl(leaves, 0, fn(leaf, total) { total + leaf.power })
  expect valid_power(total_power)
  Record { root: root(count, leaves, []), count, total_power }
}

fn full_order(leaves: List<Leaf>, index: Int, keys: List<ByteArray>) -> Bool {
  when leaves is {
    [] -> True
    [leaf, ..rest] -> and {
        leaf.index == index,
        !list.has(keys, leaf.pubkey),
        when rest is {
          [] -> True
          [next, ..] ->
            ordered(leaf.pubkey, leaf.power, next.pubkey, next.power)
        },
        full_order(rest, index + 1, [leaf.pubkey, ..keys]),
      }
  }
}

/// Continuations pass hashes and proof cursors directly between branches.
/// They avoid wrapping the remaining witness lists into a tuple at each node.
fn walk_changes(
  start: Int,
  count: Int,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
  finish: fn(ByteArray, ByteArray, List<PowerChange>, List<ByteArray>) ->
    ByteArray,
) -> ByteArray {
  let covered =
    when leaves is {
      [leaf, ..] -> leaf.index < start + count
      [] -> False
    }
  if covered {
    expect [leaf, ..rest] = leaves
    expect leaf.index >= start
    if count == 1 {
      let old_hash = leaf_hash(leaf.pubkey, leaf.old_power)
      let new_hash =
        if leaf.old_power == leaf.new_power {
          old_hash
        } else {
          leaf_hash(leaf.pubkey, leaf.new_power)
        }
      finish(old_hash, new_hash, rest, siblings)
    } else {
      let pivot = split(count, 1)
      walk_changes(
        start,
        pivot,
        leaves,
        siblings,
        fn(old_left, new_left, after_left, remaining) {
          walk_changes(
            start + pivot,
            count - pivot,
            after_left,
            remaining,
            fn(old_right, new_right, after_right, tail) {
              let old_hash = hash.inner_hash_opt_sha2_256(old_left, old_right)
              let new_hash =
                if old_left == new_left && old_right == new_right {
                  old_hash
                } else {
                  hash.inner_hash_opt_sha2_256(new_left, new_right)
                }
              finish(old_hash, new_hash, after_right, tail)
            },
          )
        },
      )
    }
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == 32
    finish(sibling, sibling, leaves, rest)
  }
}

fn authenticated_new_root(
  old: Record,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
) -> ByteArray {
  walk_changes(
    0,
    old.count,
    leaves,
    siblings,
    fn(old_root, new_root, remaining, tail) {
      expect old_root == old.root && remaining == [] && tail == []
      new_root
    },
  )
}

/// Boundary neighbors must be disclosed for every changed position. This
/// proves the new canonical ordering without disclosing unchanged subtrees.
fn updated_total(
  leaves: List<PowerChange>,
  previous: Option<PowerChange>,
  count: Int,
  total: Int,
) -> Int {
  when leaves is {
    [] -> {
      expect valid_power(total)
      total
    }
    [leaf, ..rest] -> {
      let changed = leaf.old_power != leaf.new_power
      expect
        when previous is {
          None -> !changed || leaf.index == 0
          Some(prev) -> {
            expect prev.index < leaf.index
            if prev.index + 1 == leaf.index {
              !changed && prev.old_power == prev.new_power || ordered(
                prev.pubkey,
                prev.new_power,
                leaf.pubkey,
                leaf.new_power,
              )
            } else {
              !changed
            }
          }
        }
      expect
        when rest is {
          [] -> !changed || leaf.index == count - 1
          [next, ..] -> !changed || next.index == leaf.index + 1
        }
      updated_total(
        rest,
        Some(leaf),
        count,
        total + leaf.new_power - leaf.old_power,
      )
    }
  }
}

pub fn powers(
  old: Record,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
) -> Record {
  expect old.count > 0 && old.count <= max_validators
  expect leaves != []
  let total_power = updated_total(leaves, None, old.count, old.total_power)
  let new_root = authenticated_new_root(old, leaves, siblings)
  Record { root: new_root, count: old.count, total_power }
}

/// Merge the selected signers against leaves authenticated by the one tree
/// traversal. Consuming a matched leaf prevents duplicate or reordered signers.
fn signed_old_power(leaves: List<PowerChange>, signers: List<Leaf>) -> Int {
  when signers is {
    [] -> 0
    [signer, ..remaining_signers] -> {
      expect [leaf, ..rest] = leaves
      expect signer.index >= leaf.index
      if signer.index == leaf.index {
        expect signer.pubkey == leaf.pubkey && signer.power == leaf.new_power
        leaf.old_power + signed_old_power(rest, remaining_signers)
      } else {
        signed_old_power(rest, signers)
      }
    }
  }
}

/// Authenticate a fixed-position power transition and signer membership with
/// one proof frontier. Old signer power is meaningful only for this old root.
pub fn shared_powers(
  old: Record,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
  signers: List<Leaf>,
) -> (Record, Int) {
  expect old.count > 0 && old.count <= max_validators
  expect leaves != []
  let total_power = updated_total(leaves, None, old.count, old.total_power)
  let new_root = authenticated_new_root(old, leaves, siblings)
  let old_signed_power = signed_old_power(leaves, signers)
  (Record { root: new_root, count: old.count, total_power }, old_signed_power)
}

fn walk_hashes(
  count: Int,
  hashes: List<ByteArray>,
  finish: fn(ByteArray, List<ByteArray>) -> ByteArray,
) -> ByteArray {
  if count == 1 {
    expect [leaf, ..rest] = hashes
    expect bytearray.length(leaf) == 32
    finish(leaf, rest)
  } else {
    let pivot = split(count, 1)
    walk_hashes(
      pivot,
      hashes,
      fn(left, remaining) {
        walk_hashes(
          count - pivot,
          remaining,
          fn(right, tail) {
            finish(hash.inner_hash_opt_sha2_256(left, right), tail)
          },
        )
      },
    )
  }
}

/// A complete vector of leaf hashes follows the canonical RFC-6962 shape.
/// This avoids decoding validators or recomputing hashes already authenticated
/// by the caller. Every supplied hash is checked and consumed exactly once.
pub fn hashes_root(hashes: List<ByteArray>) -> ByteArray {
  let count = list.length(hashes)
  expect count > 0 && count <= max_validators
  walk_hashes(
    count,
    hashes,
    fn(root, remaining) {
      expect remaining == []
      root
    },
  )
}

fn walk_packed(
  start: Int,
  count: Int,
  vector: ByteArray,
  stride: Int,
  hash_offset: Int,
) -> ByteArray {
  if count == 1 {
    builtin.slice_bytearray(start * stride + hash_offset, 32, vector)
  } else {
    let pivot = split(count, 1)
    let left = walk_packed(start, pivot, vector, stride, hash_offset)
    let right =
      walk_packed(start + pivot, count - pivot, vector, stride, hash_offset)
    hash.inner_hash_opt_sha2_256(left, right)
  }
}

/// Internal native vectors can retain fixed-size metadata beside each hash.
/// Validate their dimensions once, then read exact hash32 slices directly.
pub fn packed_root(
  count: Int,
  vector: ByteArray,
  stride: Int,
  hash_offset: Int,
) -> ByteArray {
  expect count > 0 && count <= max_validators
  expect stride >= 32 && hash_offset >= 0 && hash_offset + 32 <= stride
  expect bytearray.length(vector) == count * stride
  walk_packed(0, count, vector, stride, hash_offset)
}
