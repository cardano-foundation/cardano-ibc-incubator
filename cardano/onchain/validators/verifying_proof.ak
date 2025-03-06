use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyNonMembership, VerifyProofRedeemer,
}

validator verify_proof {
  mint(
    redeemer: VerifyProofRedeemer,
    _policy_id: PolicyId,
    _transaction: Transaction,
  ) {
    when redeemer is {
      VerifyMembership {
        cs,
        cons_state,
        height,
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
        delay_time_period,
        delay_block_period,
        proof,
        path,
      } ->
        client_state_mod.verify_non_membership(
          cs,
          cons_state,
          height,
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
