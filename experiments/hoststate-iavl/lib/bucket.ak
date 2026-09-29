// Preserve the current 64-bit outer tree. Resolve route collisions with a
// canonical binary Patricia tree over the remaining 192 digest bits. Singleton
// bucket roots are byte-for-byte identical to today's occupied leaves.
use aiken/builtin
use aiken/primitive/bytearray
use sparse_baseline

pub type Occupant {
  key_hash: ByteArray,
  value_hash: ByteArray,
}

pub type Step {
  bit: Int,
  sibling: ByteArray,
}

pub type Witness {
  // Only an absent-key request needs to reveal a different occupied leaf.
  occupant: Option<Occupant>,
  bucket_path: List<Step>,
  outer_siblings: List<ByteArray>,
}

pub type CompressedWitness {
  occupant: Option<Occupant>,
  bucket_path: List<Step>,
  bitmap: Int,
  outer_siblings: List<ByteArray>,
}

fn expand(
  bitmap: Int,
  siblings: List<ByteArray>,
  remaining: Int,
) -> List<ByteArray> {
  if remaining == 0 {
    expect bitmap == 0 && siblings == []
    []
  } else if bitmap % 2 == 0 {
    [sparse_baseline.empty_hash, ..expand(bitmap / 2, siblings, remaining - 1)]
  } else {
    expect [sibling, ..rest] = siblings
    expect sibling != sparse_baseline.empty_hash
    [sibling, ..expand(bitmap / 2, rest, remaining - 1)]
  }
}

pub fn apply_compressed_update(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  witness: CompressedWitness,
) -> ByteArray {
  expect witness.bitmap >= 0
  apply_update(
    old_root,
    key,
    old_value,
    new_value,
    Witness {
      occupant: witness.occupant,
      bucket_path: witness.bucket_path,
      outer_siblings: expand(witness.bitmap, witness.outer_siblings, 64),
    },
  )
}

fn direction(key: ByteArray, bit: Int) -> Int {
  let byte = builtin.index_bytearray(key, 8 + bit / 8)
  byte / builtin.index_bytearray(#"8040201008040201", bit % 8) % 2
}

pub fn branch_hash(bit: Int, left: ByteArray, right: ByteArray) -> ByteArray {
  // 0x00 is an existing occupied leaf, 0x01 an outer node, 0x02 a bucket branch.
  #"02"
    |> bytearray.concat(builtin.integer_to_bytearray(True, 1, bit))
    |> bytearray.concat(left)
    |> bytearray.concat(right)
    |> builtin.sha2_256()
}

fn step_hash(key: ByteArray, current: ByteArray, step: Step) -> ByteArray {
  if direction(key, step.bit) == 0 {
    branch_hash(step.bit, current, step.sibling)
  } else {
    branch_hash(step.bit, step.sibling, current)
  }
}

fn fold(key: ByteArray, current: ByteArray, path: List<Step>) -> ByteArray {
  when path is {
    [] -> current
    [step, ..rest] -> fold(key, step_hash(key, current, step), rest)
  }
}

fn authenticate_path(
  query: ByteArray,
  owner: ByteArray,
  current: ByteArray,
  path: List<Step>,
  upper: Int,
) -> ByteArray {
  when path is {
    [] -> current
    [step, ..rest] -> {
      expect step.bit >= 0 && step.bit < upper
      expect bytearray.length(step.sibling) == 32
      expect step.sibling != sparse_baseline.empty_hash
      let side = direction(query, step.bit)
      expect query == owner || side == direction(owner, step.bit)
      let next =
        if side == 0 {
          branch_hash(step.bit, current, step.sibling)
        } else {
          branch_hash(step.bit, step.sibling, current)
        }
      authenticate_path(query, owner, next, rest, step.bit)
    }
  }
}

fn outer_root(
  index: Int,
  current: ByteArray,
  siblings: List<ByteArray>,
  remaining: Int,
) -> ByteArray {
  if remaining == 0 {
    expect siblings == []
    current
  } else {
    expect [sibling, ..rest] = siblings
    expect bytearray.length(sibling) == 32
    let next =
      if index % 2 == 0 {
        sparse_baseline.inner_hash(current, sibling)
      } else {
        sparse_baseline.inner_hash(sibling, current)
      }
    outer_root(index / 2, next, rest, remaining - 1)
  }
}

fn first_difference(a: ByteArray, b: ByteArray, byte: Int) -> Int {
  expect byte < 32
  let x = builtin.index_bytearray(a, byte)
  let y = builtin.index_bytearray(b, byte)
  if x == y {
    first_difference(a, b, byte + 1)
  } else {
    ( byte - 8 ) * 8 + differing_bit(x, y, 128, 0)
  }
}

fn differing_bit(a: Int, b: Int, mask: Int, bit: Int) -> Int {
  if a / mask % 2 != b / mask % 2 {
    bit
  } else {
    differing_bit(a, b, mask / 2, bit + 1)
  }
}

fn join(
  key: ByteArray,
  bit: Int,
  leaf: ByteArray,
  subtree: ByteArray,
) -> ByteArray {
  if direction(key, bit) == 0 {
    branch_hash(bit, leaf, subtree)
  } else {
    branch_hash(bit, subtree, leaf)
  }
}

fn insert(
  key: ByteArray,
  bit: Int,
  leaf: ByteArray,
  subtree: ByteArray,
  path: List<Step>,
) -> ByteArray {
  when path is {
    [] -> join(key, bit, leaf, subtree)
    [step, ..rest] ->
      // Insert at the first differing bit. Unary branches are never stored.
      if step.bit > bit {
        insert(key, bit, leaf, step_hash(key, subtree, step), rest)
      } else {
        expect step.bit < bit
        fold(key, join(key, bit, leaf, subtree), path)
      }
  }
}

// Exposed only so deterministic tests can force identical 64-bit prefixes.
// Production callers must use apply_update, which hashes the actual key.
pub fn apply_digest_update(
  old_root: ByteArray,
  key_hash: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  witness: Witness,
) -> ByteArray {
  expect bytearray.length(key_hash) == 32
  let route = builtin.slice_bytearray(0, 8, key_hash)
  let index = builtin.bytearray_to_integer(True, route)
  let old_value_hash = builtin.sha2_256(old_value)
  let existing = old_value != #""
  let (owner, old_leaf) =
    if existing {
      expect witness.occupant == None
      (key_hash, sparse_baseline.leaf_hash(key_hash, old_value_hash))
    } else {
      when witness.occupant is {
        None -> {
          expect witness.bucket_path == []
          (key_hash, sparse_baseline.empty_hash)
        }
        Some(Occupant { key_hash: owner, value_hash }) -> {
          expect
            bytearray.length(owner) == 32 && bytearray.length(value_hash) == 32
          expect builtin.slice_bytearray(0, 8, owner) == route
          expect owner != key_hash
          expect value_hash != sparse_baseline.empty_value_hash
          (owner, sparse_baseline.leaf_hash(owner, value_hash))
        }
      }
    }
  let old_bucket =
    authenticate_path(key_hash, owner, old_leaf, witness.bucket_path, 192)
  expect outer_root(index, old_bucket, witness.outer_siblings, 64) == old_root
  let new_leaf =
    sparse_baseline.leaf_hash(key_hash, builtin.sha2_256(new_value))
  let new_bucket =
    if existing {
      if new_value == #"" {
        when witness.bucket_path is {
          [] -> sparse_baseline.empty_hash
          [step, ..rest] -> fold(key_hash, step.sibling, rest)
        }
      } else {
        fold(key_hash, new_leaf, witness.bucket_path)
      }
    } else if new_value == #"" {
      old_bucket
    } else if old_leaf == sparse_baseline.empty_hash {
      new_leaf
    } else {
      insert(
        key_hash,
        first_difference(key_hash, owner, 8),
        new_leaf,
        old_leaf,
        witness.bucket_path,
      )
    }
  outer_root(index, new_bucket, witness.outer_siblings, 64)
}

pub fn apply_update(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  witness: Witness,
) -> ByteArray {
  apply_digest_update(
    old_root,
    builtin.sha2_256(key),
    old_value,
    new_value,
    witness,
  )
}
