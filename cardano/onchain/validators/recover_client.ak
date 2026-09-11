use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_datum as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckClientHistory, RecoverClient, RecoverClientWithdrawal,
  RecoverClientWithdrawalRedeemer, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/height
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/validator_utils

validator recover_client(host_state_nft_policy_id: PolicyId) {
  withdraw(
    redeemer: RecoverClientWithdrawalRedeemer,
    _credential: Credential,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      extra_signatories,
      validity_range,
      redeemers,
      ..
    } = transaction

    let subject_token =
      when redeemer is {
        RecoverClientWithdrawal { subject_token, .. } -> subject_token
        CheckClientHistory { subject_token } -> subject_token
      }
    expect [subject_input] =
      list.filter(
        inputs,
        fn(input) { auth.contain_auth_token(input.output, subject_token) },
      )
    expect subject_datum: ClientDatum =
      validator_utils.get_inline_datum(subject_input.output)
    expect subject_datum.token == subject_token
    expect client_datum_mod.has_singleton_history(subject_datum)
    expect Some(raw_spend_redeemer) =
      pairs.get_first(redeemers, Spend(subject_input.output_reference))
    expect spend_redeemer: SpendClientRedeemer = raw_spend_redeemer
    let subject_output =
      validator_utils.find_unique_continuation_output(
        subject_input.output,
        outputs,
        subject_token,
      )
    expect auth.contains_only_auth_tokens(subject_output, [subject_token])
    expect recovered_datum: ClientDatum =
      validator_utils.get_inline_datum(subject_output)
    expect recovered_datum.token == subject_token
    let valid_to = validator_utils.get_tx_valid_to(validity_range) * 1_000_000

    when redeemer is {
      CheckClientHistory { .. } -> {
        expect UpdateClient { msg, history_witnesses, history_siblings } =
          spend_redeemer
        // This forces every bounded witness authentication, including relevance,
        // distinctness, full client/height identity, metadata and expiry checks.
        expect
          list.length(
            consensus_history.consensus_states_for_message(
              subject_datum,
              history_witnesses,
              valid_to,
              msg,
            ),
          ) == 1 + list.length(history_witnesses)
        when
          height.compare(
            recovered_datum.state.client_state.latest_height,
            subject_datum.state.client_state.latest_height,
          )
        is {
          Equal -> and {
              history_siblings == [],
              client_datum_mod.update_state_on_misbehaviour(
                subject_datum,
                recovered_datum,
              ),
            }
          Greater -> {
            expect HeaderCase(header) = msg
            and {
              client_datum_mod.update_state(
                subject_datum,
                recovered_datum,
                header,
                valid_to / 1_000_000,
              ),
              preserve_checkpoint(
                subject_datum,
                recovered_datum,
                history_siblings,
              ),
            }
          }
          Less -> False
        }
      }
      RecoverClientWithdrawal { substitute_token, .. } -> {
        // Recovery is an explicit administrative operation. The unique HostState
        // identifies the authority for this deployment.
        expect [host_input] =
          list.filter(
            inputs,
            fn(input) {
              assets.has_nft(
                input.output.value,
                host_state_nft_policy_id,
                host_state_token_name,
              )
            },
          )
        expect host_state_datum: HostStateDatum =
          validator_utils.get_inline_datum(host_input.output)
        expect host_state_datum.nft_policy == host_state_nft_policy_id
        expect list.has(extra_signatories, host_state_datum.deployer)

        expect subject_token != substitute_token
        expect subject_token.policy_id == substitute_token.policy_id

        // The client spend must name the same substitute as the withdrawal.
        expect RecoverClient {
          substitute_token: spend_substitute_token,
          history_siblings,
        } = spend_redeemer
        expect spend_substitute_token == substitute_token

        expect [substitute_input] =
          list.filter(
            reference_inputs,
            fn(input) {
              auth.contain_auth_token(input.output, substitute_token)
            },
          )
        expect substitute_input.output.address == subject_input.output.address
        expect substitute_datum: ClientDatum =
          validator_utils.get_inline_datum(substitute_input.output)
        expect substitute_datum.token == substitute_token
        expect
          auth.contains_only_auth_tokens(
            substitute_input.output,
            [substitute_token],
          )

        expect
          client_state_mod.status(
            subject_datum.state.client_state,
            valid_to,
            subject_datum.state.consensus_states,
          ) != Active
        expect
          client_state_mod.status(
            substitute_datum.state.client_state,
            valid_to,
            substitute_datum.state.consensus_states,
          ) == Active

        and {
          preserve_checkpoint(subject_datum, recovered_datum, history_siblings),
          client_datum_mod.recover_state(
            subject_datum,
            substitute_datum,
            recovered_datum,
          ),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn preserve_checkpoint(
  datum: ClientDatum,
  updated: ClientDatum,
  siblings: List<ByteArray>,
) -> Bool {
  consensus_history.insert(
    datum.history_root,
    consensus_history.from_client(datum),
    siblings,
  ) == updated.history_root
}
