use aiken/math
use aiken/primitive/bytearray
use ibc/core/ics_025_handler_interface/ibc_state_commitment

/// Prototype encoding for one 64-level HostState sparse-Merkle witness.
///
/// Bit n selects tree level n, using the least-significant bit first in each
/// byte. A zero bit reconstructs the protocol's all-zero empty hash. A one bit
/// consumes the next 32 bytes from siblings.
pub type CompactSparsePath {
  non_default_bitmap: ByteArray,
  siblings: ByteArray,
}

/// Expand the compact wire form into the existing 64-element witness without
/// changing the HostState commitment algorithm.
pub fn expand(path: CompactSparsePath) -> Option<List<ByteArray>> {
  if bytearray.length(path.non_default_bitmap) != 8 || bytearray.length(
    path.siblings,
  ) % ibc_state_commitment.hash_size_bytes != 0 {
    None
  } else {
    expand_at(path, 0, 0)
  }
}

fn expand_at(
  path: CompactSparsePath,
  depth: Int,
  sibling_offset: Int,
) -> Option<List<ByteArray>> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    if sibling_offset == bytearray.length(path.siblings) {
      Some([])
    } else {
      None
    }
  } else if bit_is_set(path.non_default_bitmap, depth) {
    let next_offset = sibling_offset + ibc_state_commitment.hash_size_bytes

    if next_offset > bytearray.length(path.siblings) {
      None
    } else {
      let sibling =
        bytearray.slice(path.siblings, sibling_offset, next_offset - 1)

      // Encoding the default hash behind a set bit is non-canonical and would
      // allow multiple byte representations of the same witness.
      if sibling == ibc_state_commitment.empty_hash {
        None
      } else {
        when expand_at(path, depth + 1, next_offset) is {
          None -> None
          Some(rest) -> Some([sibling, ..rest])
        }
      }
    }
  } else {
    when expand_at(path, depth + 1, sibling_offset) is {
      None -> None
      Some(rest) -> Some([ibc_state_commitment.empty_hash, ..rest])
    }
  }
}

fn bit_is_set(bitmap: ByteArray, bit_index: Int) -> Bool {
  let byte = bytearray.at(bitmap, bit_index / 8)
  let mask = math.pow2(bit_index % 8)
  byte / mask % 2 == 1
}
