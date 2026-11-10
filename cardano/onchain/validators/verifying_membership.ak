use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_datum
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyProofEnvelope,
}
use ibc/utils/validator_utils

// Separate entry point keeps non-membership and client-upgrade execution out
// of the script referenced by ordinary packet receives and acknowledgements.
validator verify_membership {
  mint(
    redeemer: VerifyProofEnvelope,
    policy_id: PolicyId,
    transaction: Transaction,
  ) {
    expect
      validator_utils.require_exact_marker_mint(
        transaction.mint,
        policy_id,
        "",
        1,
      )
    let current_time =
      validator_utils.get_tx_valid_from(transaction.validity_range) * 1_000_000
    let current_height = client_datum.processed_height_from_time(current_time)
    when redeemer.proof is {
      VerifyMembership {
        cs,
        cons_state,
        height,
        processed_time,
        processed_height,
        delay_time_period,
        delay_block_period,
        proof,
        path,
        value,
      } ->
        client_state.verify_membership(
          cs,
          cons_state,
          height,
          processed_time,
          processed_height,
          current_time,
          current_height,
          delay_time_period,
          delay_block_period,
          proof,
          path,
          value,
        )
      BatchVerifyMembership(items) -> and {
          !list.is_empty(items),
          list.all(
            items,
            fn(i) {
              client_state.verify_membership(
                i.cs,
                i.cons_state,
                i.height,
                i.processed_time,
                i.processed_height,
                current_time,
                current_height,
                i.delay_time_period,
                i.delay_block_period,
                i.proof,
                i.path,
                i.value,
              )
            },
          ),
        }
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
