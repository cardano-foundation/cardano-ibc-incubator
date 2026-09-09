use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Spend, Transaction, Withdraw}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClient, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/misbehaviour_handle as misbehaviour_handle_mod
use ibc/client/ics_007_tendermint_client/update as update_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer
use ibc/utils/tx_time.{TxTime} as tx_time_mod
use ibc/utils/validator_utils

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      assets.has_nft(input.output.value, nft_policy, host_state_token_name)
    },
  )
}

fn require_archive(transaction: Transaction, datum: ClientDatum) -> Bool {
  // HostState permits one client continuation. Its UpdateClient branch rules
  // out client creation, so the only policy branch that can mint here is the
  // archive branch, which checks this client's exact checkpoint and NFT name.
  expect [Pair(_, quantity)] =
    transaction.mint |> assets.tokens(datum.token.policy_id) |> dict.to_pairs
  quantity == 1
}

validator spend_client(
  host_state_nft_policy_id: PolicyId,
  recover_client_credential: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { outputs, inputs, validity_range, redeemers, .. } =
      transaction

    // Any client state update must be committed into the HostState root in the
    // same transaction, using the HostState branch that commits client keys.
    expect Some(host_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)
    expect Some(spent_host_state_redeemer) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    expect host_state_redeemer.UpdateClient { .. }: host_state_redeemer.HostStateRedeemer =
      spent_host_state_redeemer

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    //========================valid input=======================
    // input contains client token
    expect Some(datum) = datum
    expect auth.contain_auth_token(spent_output, datum.token)

    //========================valid output=======================
    let updated_output =
      validator_utils.find_unique_continuation_output(
        spent_output,
        outputs,
        datum.token,
      )

    // output contains client token
    expect
      assets.match_assets(
        updated_output.value,
        assets.from_asset(datum.token.policy_id, datum.token.name, 1),
      )

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
        let proof_states =
          consensus_history.consensus_states_for_message(
            datum,
            transaction.reference_inputs,
            tx_time.valid_to,
            msg,
          )
        expect
          update_mod.verify_client_message(
            datum.state.client_state,
            tx_time,
            proof_states,
            msg,
          )
        trace @"spend_client: verify client msg succeeded"

        let found_misbehaviour =
          misbehaviour_handle_mod.check_for_misbehaviour(msg, proof_states)

        if found_misbehaviour {
          trace @"spend_client: found misbehaviour"
          expect updated_datum: ClientDatum =
            validator_utils.get_inline_datum(updated_output)
          client_datum_mod.update_state_on_misbehaviour(datum, updated_datum)?
        } else {
          // The canonical mint policy reads this same spend redeemer and checks
          // its new checkpoint, processing metadata and HostState commitment.
          require_archive(transaction, datum)
        }
      }

      RecoverClient { .. } -> {
        trace @"spend_client: RecoverClient branch"

        and {
          require_archive(transaction, datum),
          pairs.has_key(redeemers, Withdraw(recover_client_credential)),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
