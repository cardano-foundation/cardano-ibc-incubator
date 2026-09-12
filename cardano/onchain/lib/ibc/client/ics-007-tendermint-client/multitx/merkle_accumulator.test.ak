use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/multitx/merkle_accumulator

fn values() -> List<ByteArray> {
  [#"00", #"01", #"02", #"03", #"04", #"05", #"06", #"07", #"08"]
}

fn take(items: List<a>, count: Int) -> List<a> {
  when items is {
    [] -> []
    [head, ..tail] ->
      if count <= 0 {
        []
      } else {
        [head, ..take(tail, count - 1)]
      }
  }
}

fn streaming_root(items: List<ByteArray>) -> ByteArray {
  merkle_accumulator.root(
    merkle_accumulator.append_all(merkle_accumulator.empty(), items),
  )
}

test empty_root_matches_cometbft() {
  streaming_root([]) == tree.hash_from_byte_slices_sha2_256([])
}

test streaming_roots_match_cometbft_for_balanced_and_unbalanced_counts() {
  list.all(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    fn(count) {
      let items = take(values(), count)
      streaming_root(items) == tree.hash_from_byte_slices_sha2_256(items)
    },
  )
}

test accumulator_retains_only_logarithmic_peaks() {
  let merkle_accumulator.MerkleAccumulator { count, peaks } =
    merkle_accumulator.append_all(merkle_accumulator.empty(), values())
  count == 9 && list.length(peaks) == 2
}
