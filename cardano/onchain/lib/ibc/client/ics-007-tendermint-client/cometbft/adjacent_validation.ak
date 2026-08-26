use aiken/builtin
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/vote

/// Verify an adjacent commit by walking its validators and signatures in
/// lockstep. The previous indexed fold repeatedly looked up both collections
/// from their heads, making the verification quadratic in the validator count.
pub fn verify_commit_single(
  chain_id: ByteArray,
  validators: List<Validator>,
  commit: Commit,
  voting_power_needed: Int,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  let
    tallied_voting_power,
    partial_passed,
  <-
    verify_from_right(
      chain_id,
      validators,
      commit.signatures,
      commit,
      voting_power_needed,
      list_vote_sign_bytes,
    )
  partial_passed || tallied_voting_power > voting_power_needed
}

/// Preserve the old right-fold evaluation order while consuming both lists
/// exactly once. In particular, signatures to the left of an established
/// quorum remain unverified, matching the existing early-exit behavior.
fn verify_from_right(
  chain_id: ByteArray,
  validators: List<Validator>,
  signatures: List<CommitSig>,
  commit: Commit,
  voting_power_needed: Int,
  list_vote_sign_bytes: Option<List<ByteArray>>,
  return: fn(Int, Bool) -> result,
) -> result {
  when validators is {
    [] -> {
      expect signatures == []
      return(0, False)
    }
    [current_validator, ..remaining_validators] ->
      when signatures is {
        [] -> fail @"Mismatched adjacent validator and signature counts"
        [current_signature, ..remaining_signatures] -> {
          let (vote_sign_bytes_at_index, remaining_vote_sign_bytes) =
            when list_vote_sign_bytes is {
              None -> (None, None)
              Some([]) -> (None, Some([]))
              Some([vote_sign_bytes, ..remaining]) ->
                (Some(vote_sign_bytes), Some(remaining))
            }

          let
            tallied_voting_power,
            partial_passed,
          <-
            verify_from_right(
              chain_id,
              remaining_validators,
              remaining_signatures,
              commit,
              voting_power_needed,
              remaining_vote_sign_bytes,
            )

          if current_signature.block_id_flag != block_id_flag_commit || partial_passed {
            return(tallied_voting_power, partial_passed)
          } else {
            let vote_sign_bytes =
              when list_vote_sign_bytes is {
                Some(_) -> {
                  expect Some(vote_bytes) = vote_sign_bytes_at_index
                  vote_bytes
                }
                None ->
                  vote.vote_sign_bytes_for_commit_sig(
                    commit,
                    chain_id,
                    current_signature,
                  )
              }

            expect
              builtin.verify_ed25519_signature(
                current_validator.pubkey,
                vote_sign_bytes,
                current_signature.signature,
              )

            let new_tallied_voting_power =
              tallied_voting_power + current_validator.voting_power

            if new_tallied_voting_power > voting_power_needed {
              return(new_tallied_voting_power, True)
            } else {
              return(new_tallied_voting_power, False)
            }
          }
        }
      }
  }
}
