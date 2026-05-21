use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_datum
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/utils/validator_utils

validator verify_proof {
  mint(
    redeemer: VerifyProofRedeemer,
    policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let tx_valid_from =
      validator_utils.get_tx_valid_from(transaction.validity_range)
    let current_time = tx_valid_from * 1_000_000
    let current_height = client_datum.processed_height_from_time(current_time)

    expect
      validator_utils.require_exact_marker_mint(
        transaction.mint,
        policy_id,
        "",
        1,
      )

    when redeemer is {
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
        client_state_mod.verify_membership(
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

      VerifyNonMembership {
        cs,
        cons_state,
        height,
        processed_time,
        processed_height,
        delay_time_period,
        delay_block_period,
        proof,
        path,
      } ->
        client_state_mod.verify_non_membership(
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
        )

      BatchVerifyMembership(items) ->
        list.all(
          items,
          fn(i) {
            client_state_mod.verify_membership(
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
        )

      _ -> False
    }
  }

  else(_) {
    fail
  }
}
