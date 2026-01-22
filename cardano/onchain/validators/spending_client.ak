use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, OutputReference, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  Other, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/misbehaviour_handle as misbehaviour_handle_mod
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/update as update_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/utils/tx_time.{TxTime} as tx_time_mod
use ibc/utils/validator_utils

validator spend_client(host_state_nft_policy_id: PolicyId) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { outputs, inputs, validity_range, .. } = transaction

    // Any client state update must be committed into the HostState root in the same transaction.
    expect _ =
      validator_utils.require_host_state_thread(
        inputs,
        outputs,
        host_state_nft_policy_id,
      )

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    //========================valid input=======================
    // input contains client token
    expect Some(datum) = datum
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains client token
    expect updated_output |> auth.contains_only_auth_tokens([datum.token])

    // TODO: add verify header
    // output datum is updated correctly
    expect updated_datum: ClientDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      UpdateClient { msg } -> {
        trace @"spend_client: UpdateClient branch"

        let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

        let tx_valid_from = validator_utils.get_tx_valid_from(validity_range)

        expect
          client_state_mod.status(
            datum.state.client_state,
            tx_valid_to * 1_000_000,
            datum.state.consensus_states,
          ) == client_status_mod.Active
        trace @"spend_client: client status is Active"

        let tx_time =
          TxTime {
            valid_from: tx_valid_from * 1_000_000,
            valid_to: tx_valid_to * 1_000_000,
          }
        expect
          update_mod.verify_client_message(
            datum.state.client_state,
            tx_time,
            datum.state.consensus_states,
            msg,
          )
        trace @"spend_client: verify client msg succeeded"

        let found_misbehaviour =
          misbehaviour_handle_mod.check_for_misbehaviour(
            msg,
            datum.state.consensus_states,
          )

        if found_misbehaviour {
          trace @"spend_client: found misbehaviour"
          client_datum_mod.update_state_on_misbehaviour(datum, updated_datum)?
        } else {
          expect HeaderCase(header) = msg
          client_datum_mod.update_state(
            datum,
            updated_datum,
            header,
            tx_valid_from,
          )?
        }
      }

      Other -> False
    }
  }

  else(_) {
    fail
  }
}
