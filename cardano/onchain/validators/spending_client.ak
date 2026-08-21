use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  Other, PruneTerminalConsensusStates, ReclaimClient, SpendClientRedeemer,
  UpdateClient,
}
use ibc/client/ics_007_tendermint_client/update as update_mod
use ibc/core/ics_025_handler_interface/host_state_redeemer
use ibc/utils/tx_time.{TxTime} as tx_time_mod
use ibc/utils/validator_utils

fn require_host_companion(
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_nft_policy_id: PolicyId,
) -> host_state_redeemer.HostStateRedeemer {
  let (host_input, _) =
    validator_utils.require_host_state_thread(
      inputs,
      outputs,
      host_state_nft_policy_id,
    )
  expect Some(spent_host_state_redeemer) =
    pairs.get_first(redeemers, Spend(host_input.output_reference))
  expect host_redeemer: host_state_redeemer.HostStateRedeemer =
    spent_host_state_redeemer
  host_redeemer
}

validator spend_client(host_state_nft_policy_id: PolicyId) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { outputs, inputs, mint, validity_range, redeemers, .. } =
      transaction

    let host_redeemer =
      require_host_companion(
        inputs,
        outputs,
        redeemers,
        host_state_nft_policy_id,
      )

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    //========================valid input=======================
    // input contains client token
    expect Some(datum) = datum
    expect auth.contain_auth_token(spent_output, datum.token)

    when redeemer is {
      UpdateClient { msg } -> {
        trace @"spend_client: UpdateClient branch"

        expect host_state_redeemer.UpdateClient { .. } = host_redeemer
        let updated_output =
          validator_utils.find_unique_continuation_output(
            spent_output,
            outputs,
            datum.token,
          )
        expect auth.contains_only_auth_tokens(updated_output, [datum.token])
        let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

        let tx_valid_from = validator_utils.get_tx_valid_from(validity_range)

        let tx_time =
          TxTime {
            valid_from: tx_valid_from * 1_000_000,
            valid_to: tx_valid_to * 1_000_000,
          }
        update_mod.verify_client_message(
          datum.state.client_state,
          tx_time,
          datum.state.consensus_states,
          msg,
        )
      }

      PruneTerminalConsensusStates -> {
        trace @"spend_client: PruneTerminalConsensusStates branch"

        expect host_state_redeemer.PruneTerminalClient { .. } = host_redeemer
        let updated_output =
          validator_utils.find_unique_continuation_output(
            spent_output,
            outputs,
            datum.token,
          )
        auth.contains_only_auth_tokens(updated_output, [datum.token])
      }

      ReclaimClient { reclaim_to } -> {
        trace @"spend_client: ReclaimClient branch"

        expect host_state_redeemer.ReclaimClient {
          reclaim_to: host_reclaim_to,
          ..
        } = host_redeemer
        and {
          host_reclaim_to == reclaim_to,
          auth.burn_auth_token(mint, datum.token),
          validator_utils.no_output_contains_auth_token(outputs, datum.token),
          validator_utils.pays_reclamation_bounty(
            spent_output,
            outputs,
            reclaim_to,
          ),
        }
      }

      Other -> False
    }
  }

  else(_) {
    fail
  }
}
