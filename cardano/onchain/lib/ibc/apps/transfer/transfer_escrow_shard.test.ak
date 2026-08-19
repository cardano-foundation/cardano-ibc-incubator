use aiken/primitive/bytearray
use ibc/apps/transfer/transfer_escrow_shard

const token_unit_suffix_half = "abababababababababababababab"

fn token_unit_suffix() -> ByteArray {
  bytearray.concat(token_unit_suffix_half, token_unit_suffix_half)
}

test shard_token_name_matches_cross_language_golden() {
  transfer_escrow_shard.shard_token_name(
    "channel-1",
    bytearray.concat("23", token_unit_suffix()),
  ) == #"82bd61ddc779508a845de79b0119ec03c6c5f4adaec7e1462052cc50"
}

test shard_token_name_frames_formerly_ambiguous_boundaries() {
  let first =
    transfer_escrow_shard.shard_token_name(
      "channel-1",
      bytearray.concat("23", token_unit_suffix()),
    )
  let second =
    transfer_escrow_shard.shard_token_name("channel-123", token_unit_suffix())
  first != second
}
