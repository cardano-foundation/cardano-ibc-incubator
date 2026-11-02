use aiken/cbor
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/vote_encoding
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/test_fixtures/tendermint_update_capacity

test direct_votes_match_all_retained_timestamps_and_complete_vote_encoding() {
  expect Some(data) =
    cbor.deserialise(
      tendermint_update_capacity.non_adjacent_mixed_spend_client_redeemer_cbor,
    )
  expect UpdateClient { msg: HeaderCase(header), .. }: SpendClientRedeemer =
    data
  list.all(
    [0, 1, 127, 128, 2_147_483_647],
    fn(round) {
      let commit = Commit { ..header.signed_header.commit, round }
      let chain_id = header.signed_header.header.chain_id
      let (prefix, suffix) = vote.commit_sign_parts(commit, chain_id)
      list.all(
        commit.signatures,
        fn(sig) {
          let encoded =
            vote_encoding.commit_sign_bytes(prefix, suffix, sig.timestamp)
          and {
            encoded == vote.commit_sign_bytes(prefix, suffix, sig.timestamp),
            encoded == vote.vote_sign_bytes_for_commit_sig(
              commit,
              chain_id,
              sig,
            ),
          }
        },
      )
    },
  )
}

test direct_timestamp_encoding_matches_seconds_and_nanos_varint_boundaries() {
  let prefix = #"080211ffffffffffffffff2200"
  let suffix = #"3207696e6a2d313233"
  list.all(
    [
      -62_135_596_800,
      -34_359_738_368,
      -128,
      -1,
      0,
      1,
      127,
      128,
      16_383,
      16_384,
      2_097_151,
      2_097_152,
      268_435_455,
      268_435_456,
      34_359_738_367,
      34_359_738_368,
      253_402_300_799,
    ],
    fn(seconds) {
      list.all(
        [0, 1, 127, 128, 16_383, 16_384, 2_097_151, 2_097_152, 999_999_999],
        fn(nanos) {
          let timestamp = seconds * 1_000_000_000 + nanos
          vote_encoding.commit_sign_bytes(prefix, suffix, timestamp) == vote.commit_sign_bytes(
            prefix,
            suffix,
            timestamp,
          )
        },
      )
    },
  )
}

test direct_timestamp_encoding_keeps_empty_timestamp_message() {
  vote_encoding.commit_sign_bytes(#"", #"", 0) == #"022a00"
}

test direct_vote_encoding_matches_multi_byte_message_lengths() {
  let prefix =
    #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
  let prefix = bytearray.concat(prefix, prefix)
  list.all(
    [0, 1, 124, 125, 126, 127, 128],
    fn(length) {
      let prefix = bytearray.take(prefix, length)
      list.all(
        [0, 1, 127_000_000_000, -1, 253_402_300_799_999_999_999],
        fn(timestamp) {
          vote_encoding.commit_sign_bytes(prefix, #"", timestamp) == vote.commit_sign_bytes(
            prefix,
            #"",
            timestamp,
          )
        },
      )
    },
  )
}

test direct_vote_rejects_time_below_minimum() fail {
  vote_encoding.commit_sign_bytes(#"", #"", -62_135_596_800_000_000_001) == #""
}

test direct_vote_rejects_time_at_exclusive_maximum() fail {
  vote_encoding.commit_sign_bytes(#"", #"", 253_402_300_800_000_000_000) == #""
}

test generic_vote_rejects_time_below_minimum() fail {
  vote.commit_sign_bytes(#"", #"", -62_135_596_800_000_000_001) == #""
}

test generic_vote_rejects_time_at_exclusive_maximum() fail {
  vote.commit_sign_bytes(#"", #"", 253_402_300_800_000_000_000) == #""
}
