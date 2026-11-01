use aiken/cbor
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/test_fixtures/tendermint_update_capacity

test prepared_votes_match_all_retained_timestamps_and_round_encodings() {
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
          vote.commit_sign_bytes(prefix, suffix, sig.timestamp) == vote.vote_sign_bytes_for_commit_sig(
            commit,
            chain_id,
            sig,
          )
        },
      )
    },
  )
}
