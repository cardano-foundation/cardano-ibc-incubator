// Experimental private archive. No deployed validator imports this module.
// The benchmark overlay replaces only private history insertion. Public IBC
// commitments and their sparse-tree depth are deliberately outside this API.
use aiken/builtin
use aiken/primitive/bytearray

pub const empty_root =
  #"020000000000000000e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

const max_count = 18_446_744_073_709_551_615

fn leaf(value: ByteArray) -> ByteArray {
  builtin.sha2_256(builtin.cons_bytearray(0, value))
}

fn inner(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.sha2_256(
    builtin.cons_bytearray(1, builtin.append_bytearray(left, right)),
  )
}

fn decode(root: ByteArray) -> Pair<Int, ByteArray> {
  expect bytearray.length(root) == 41
  expect bytearray.at(root, 0) == 2
  Pair(
    builtin.bytearray_to_integer(True, builtin.slice_bytearray(1, 8, root)),
    builtin.slice_bytearray(9, 32, root),
  )
}

fn commit(count: Int, hash: ByteArray) -> ByteArray {
  builtin.cons_bytearray(
    2,
    builtin.append_bytearray(builtin.integer_to_bytearray(True, 8, count), hash),
  )
}

// Peaks are ordered from smallest to largest subtree. Their presence is
// determined by the authenticated count, not by untrusted position labels.
fn fold_frontier(
  count: Int,
  peaks: List<ByteArray>,
  right: Option<ByteArray>,
) -> ByteArray {
  if count == 0 {
    expect [] = peaks
    when right is {
      None -> builtin.sha2_256(#"")
      Some(hash) -> hash
    }
  } else if count % 2 == 0 {
    fold_frontier(count / 2, peaks, right)
  } else {
    expect [peak, ..rest] = peaks
    expect bytearray.length(peak) == 32
    let next =
      when right is {
        None -> peak
        Some(hash) -> inner(peak, hash)
      }
    fold_frontier(count / 2, rest, Some(next))
  }
}

fn carry(
  count: Int,
  peaks: List<ByteArray>,
  right: ByteArray,
) -> List<ByteArray> {
  if count % 2 == 0 {
    [right, ..peaks]
  } else {
    expect [left, ..rest] = peaks
    carry(count / 2, rest, inner(left, right))
  }
}

/// The caller must authenticate the input client and pass exactly its previous
/// tip, encoded with consensus_history.value(). This function authenticates the
/// entire frontier against that input and commits count + 1 in the output.
pub fn append(
  root: ByteArray,
  value: ByteArray,
  frontier: List<ByteArray>,
) -> ByteArray {
  let Pair(count, hash) = decode(root)
  expect count < max_count
  expect fold_frontier(count, frontier, None) == hash
  let next_frontier = carry(count, frontier, leaf(value))
  commit(count + 1, fold_frontier(count + 1, next_frontier, None))
}

fn split(size: Int, power: Int) -> Int {
  if power * 2 < size {
    split(size, power * 2)
  } else {
    power
  }
}

fn inclusion(
  position: Int,
  count: Int,
  value_hash: ByteArray,
  path: List<ByteArray>,
) -> Pair<ByteArray, List<ByteArray>> {
  if count == 1 {
    Pair(value_hash, path)
  } else {
    let boundary = split(count, 1)
    let Pair(child, rest) =
      if position < boundary {
        inclusion(position, boundary, value_hash, path)
      } else {
        inclusion(position - boundary, count - boundary, value_hash, path)
      }
    expect [sibling, ..remaining] = rest
    expect bytearray.length(sibling) == 32
    Pair(
      if position < boundary {
        inner(child, sibling)
      } else {
        inner(sibling, child)
      },
      remaining,
    )
  }
}

/// The caller also binds the record's client, requested height and processing
/// metadata. An off-chain height-to-position index has no authority here.
pub fn authenticate(
  root: ByteArray,
  position: Int,
  value: ByteArray,
  path: List<ByteArray>,
) -> Bool {
  let Pair(count, hash) = decode(root)
  expect count > 0 && position >= 0 && position < count
  let Pair(actual, rest) = inclusion(position, count, leaf(value), path)
  expect [] = rest
  actual == hash
}
