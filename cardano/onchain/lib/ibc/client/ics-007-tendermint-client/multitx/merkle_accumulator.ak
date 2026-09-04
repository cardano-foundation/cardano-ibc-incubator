use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/hash

/// A perfect RFC-6962 subtree kept by the streaming validator-set hasher.
/// Peaks are stored from smallest to largest so appending a leaf is the same
/// binary-carry operation as incrementing the number of processed validators.
pub type MerklePeak {
  MerklePeak { size: Int, root: ByteArray }
}

/// Streaming representation of CometBFT's validator-set Merkle tree.
/// Its size is O(log n), regardless of the number of processed validators.
pub type MerkleAccumulator {
  MerkleAccumulator { count: Int, peaks: List<MerklePeak> }
}

pub fn empty() -> MerkleAccumulator {
  MerkleAccumulator { count: 0, peaks: [] }
}

/// Append one un-hashed validator encoding.
pub fn append(
  accumulator: MerkleAccumulator,
  value: ByteArray,
) -> MerkleAccumulator {
  let MerkleAccumulator { count, peaks } = accumulator
  MerkleAccumulator {
    count: count + 1,
    peaks: carry_peak(
      peaks,
      MerklePeak { size: 1, root: hash.leaf_hash_opt_sha2_256(value) },
    ),
  }
}

pub fn append_all(
  accumulator: MerkleAccumulator,
  values: List<ByteArray>,
) -> MerkleAccumulator {
  list.foldl(values, accumulator, fn(value, acc) { append(acc, value) })
}

fn carry_peak(peaks: List<MerklePeak>, incoming: MerklePeak) -> List<MerklePeak> {
  when peaks is {
    [] -> [incoming]
    [head, ..tail] ->
      if head.size == incoming.size {
        carry_peak(
          tail,
          MerklePeak {
            size: head.size * 2,
            root: hash.inner_hash_opt_sha2_256(head.root, incoming.root),
          },
        )
      } else {
        expect incoming.size < head.size
        [incoming, head, ..tail]
      }
  }
}

/// Finalize to the exact root returned by CometBFT's RFC-6962
/// `HashFromByteSlices`. The peaks cover the input from right to left, so they
/// are reversed and combined right-associatively.
pub fn root(accumulator: MerkleAccumulator) -> ByteArray {
  let MerkleAccumulator { count, peaks } = accumulator
  if count == 0 {
    hash.empty_hash()
  } else {
    bag_peaks(list.reverse(peaks))
  }
}

fn bag_peaks(peaks: List<MerklePeak>) -> ByteArray {
  when peaks is {
    [] -> fail @"Cannot finalize an empty non-zero Merkle accumulator"
    [only] -> only.root
    [left, ..right] -> hash.inner_hash_opt_sha2_256(left.root, bag_peaks(right))
  }
}
