use aiken/math
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash
use ibc/utils/bits

/// Largest power of two strictly below `length`, matching CometBFT's
/// RFC-6962 split rule.
pub fn split_point(length: Int) -> Int {
  expect length > 1
  let bit_len = bits.len(length)
  let candidate = math.pow2(bit_len - 1)
  if candidate == length {
    candidate / 2
  } else {
    candidate
  }
}

/// Verify an item against the exact tree shape used by CometBFT's
/// `HashFromByteSlices`.
///
/// Audit paths are root-to-leaf: the first element is the sibling at the root
/// split, followed by the proof within the selected child. `index` is zero
/// based and `total` is the complete validator count. Requiring the path to be
/// exhausted at the leaf prevents accepting shortened or padded proofs.
pub fn verify(
  expected_root: ByteArray,
  item: ByteArray,
  index: Int,
  total: Int,
  audit_path: List<ByteArray>,
) -> Bool {
  if bytearray.length(expected_root) != 32 || total <= 0 || index < 0 || index >= total {
    False
  } else {
    when
      root_from_path(
        hash.leaf_hash_opt_sha2_256(item),
        index,
        total,
        audit_path,
      )
    is {
      Some(root) -> root == expected_root
      None -> False
    }
  }
}

fn root_from_path(
  leaf: ByteArray,
  index: Int,
  total: Int,
  audit_path: List<ByteArray>,
) -> Option<ByteArray> {
  if total == 1 {
    if index == 0 && audit_path == [] {
      Some(leaf)
    } else {
      None
    }
  } else {
    when audit_path is {
      [] -> None
      [sibling, ..rest] ->
        if bytearray.length(sibling) != 32 {
          None
        } else {
          let split = split_point(total)
          if index < split {
            when root_from_path(leaf, index, split, rest) is {
              Some(left) -> Some(hash.inner_hash_opt_sha2_256(left, sibling))
              None -> None
            }
          } else {
            when root_from_path(leaf, index - split, total - split, rest) is {
              Some(right) -> Some(hash.inner_hash_opt_sha2_256(sibling, right))
              None -> None
            }
          }
        }
    }
  }
}
