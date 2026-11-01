use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, PowerChange, Record, max_validators,
}
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash
use ibc/client/ics_007_tendermint_client/multitx/types.{max_total_voting_power} as session_types
use ibc/utils/bytes

pub fn valid_power(power: Int) -> Bool {
  power > 0 && power <= max_total_voting_power
}

pub fn address(pubkey: ByteArray) -> ByteArray {
  builtin.sha2_256(pubkey) |> bytearray.take(20)
}

/// Positive Ed25519 SimpleValidator encoding. The key length and protobuf
/// field tags are fixed. Only the voting-power varint changes between roots.
pub fn leaf_bytes(pubkey: ByteArray, power: Int) -> ByteArray {
  expect bytearray.length(pubkey) == 32 && valid_power(power)
  builtin.append_bytearray(
    builtin.append_bytearray(#"0a220a20", pubkey),
    builtin.cons_bytearray(16, bytes.encode_varint(power)),
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
) -> (ByteArray, List<Leaf>, List<ByteArray>) {
  let covered =
    when leaves is {
      [leaf, ..] -> leaf.index < start + count
      [] -> False
    }
  if covered {
    expect [leaf, ..rest] = leaves
    expect leaf.index >= start
    if count == 1 {
      (leaf_hash(leaf.pubkey, leaf.power), rest, siblings)
    } else {
      let pivot = split(count, 1)
      let (left, after_left, remaining) = walk(start, pivot, leaves, siblings)
      let (right, after_right, tail) =
        walk(start + pivot, count - pivot, after_left, remaining)
      (hash.inner_hash_opt_sha2_256(left, right), after_right, tail)
    }
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == 32
    (sibling, leaves, rest)
  }
}

pub fn root(
  count: Int,
  leaves: List<Leaf>,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect count > 0 && count <= max_validators
  expect leaves != []
  let (computed, remaining, tail) = walk(0, count, leaves, siblings)
  expect remaining == [] && tail == []
  computed
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

fn walk_changes(
  start: Int,
  count: Int,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
) -> (ByteArray, ByteArray, List<PowerChange>, List<ByteArray>) {
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
      (old_hash, new_hash, rest, siblings)
    } else {
      let pivot = split(count, 1)
      let (old_left, new_left, after_left, remaining) =
        walk_changes(start, pivot, leaves, siblings)
      let (old_right, new_right, after_right, tail) =
        walk_changes(start + pivot, count - pivot, after_left, remaining)
      let old_hash = hash.inner_hash_opt_sha2_256(old_left, old_right)
      let new_hash =
        if old_left == new_left && old_right == new_right {
          old_hash
        } else {
          hash.inner_hash_opt_sha2_256(new_left, new_right)
        }
      (old_hash, new_hash, after_right, tail)
    }
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == 32
    (sibling, sibling, leaves, rest)
  }
}

/// Boundary neighbors must be disclosed for every changed position. This
/// proves the new canonical ordering without disclosing unchanged subtrees.
fn boundaries(
  leaves: List<PowerChange>,
  previous: Option<PowerChange>,
  count: Int,
) -> Bool {
  when leaves is {
    [] -> True
    [leaf, ..rest] -> {
      let changed = leaf.old_power != leaf.new_power
      and {
        when previous is {
          None -> !changed || leaf.index == 0
          Some(prev) -> and {
              prev.index < leaf.index,
              if prev.index + 1 == leaf.index {
                // The old root already authenticates unchanged ordering.
                !changed && prev.old_power == prev.new_power || ordered(
                  prev.pubkey,
                  prev.new_power,
                  leaf.pubkey,
                  leaf.new_power,
                )
              } else {
                !changed
              },
            }
        },
        when rest is {
          [] -> !changed || leaf.index == count - 1
          [next, ..] -> !changed || next.index == leaf.index + 1
        },
        boundaries(rest, Some(leaf), count),
      }
    }
  }
}

pub fn powers(
  old: Record,
  leaves: List<PowerChange>,
  siblings: List<ByteArray>,
) -> Record {
  expect old.count > 0 && old.count <= max_validators
  expect leaves != [] && boundaries(leaves, None, old.count)
  let (old_root, new_root, remaining, tail) =
    walk_changes(0, old.count, leaves, siblings)
  expect old_root == old.root && remaining == [] && tail == []
  let total_power =
    list.foldl(
      leaves,
      old.total_power,
      fn(leaf, total) { total + leaf.new_power - leaf.old_power },
    )
  expect valid_power(total_power)
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
  expect leaves != [] && boundaries(leaves, None, old.count)
  let (old_root, new_root, remaining, tail) =
    walk_changes(0, old.count, leaves, siblings)
  expect old_root == old.root && remaining == [] && tail == []
  let old_signed_power = signed_old_power(leaves, signers)
  let total_power =
    list.foldl(
      leaves,
      old.total_power,
      fn(leaf, total) { total + leaf.new_power - leaf.old_power },
    )
  expect valid_power(total_power)
  (Record { root: new_root, count: old.count, total_power }, old_signed_power)
}
