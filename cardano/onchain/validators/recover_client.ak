use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate, UnregisterCredential}
use cardano/transaction.{Spend, Transaction}
use ibc/apps/transfer/escrow as transfer_escrow
use ibc/apps/transfer/shutdown as transfer_shutdown
use ibc/apps/transfer/types/transfer_module_datum.{
  empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_datum as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckClientHistory, CheckStagedClientHistory, ReclaimStateWithdrawal,
  ReclaimTransferWithdrawal, RecoverClient, RecoverClientWithdrawal,
  RecoverClientWithdrawalRedeemer, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/height
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer as staged_client
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/shutdown
use ibc/utils/validator_utils

validator recover_client(host_state_nft_policy_id: PolicyId) {
  withdraw(
    redeemer: RecoverClientWithdrawalRedeemer,
    _credential: Credential,
    transaction: Transaction,
  ) {
    when redeemer is {
      ReclaimStateWithdrawal -> {
        expect Some(input) =
          list.find(
            transaction.inputs,
            fn(input) {
              when input.output.address.payment_credential is {
                Script(_) -> True
                _ -> False
              }
            },
          )
        shutdown.reclaim(
          transaction,
          input.output_reference,
          host_state_nft_policy_id,
          assets.zero,
        )
      }
      ReclaimTransferWithdrawal { port_unit, module_unit, escrow_policy } -> {
        let port_token =
          AuthToken {
            policy_id: bytearray.take(port_unit, 28),
            name: bytearray.drop(port_unit, 28),
          }
        let module_token =
          AuthToken {
            policy_id: bytearray.take(module_unit, 28),
            name: bytearray.drop(module_unit, 28),
          }
        if shutdown.burns_token(transaction, port_token) {
          expect [input] =
            list.filter(
              transaction.inputs,
              fn(input) {
                transfer_escrow.has_module_state_tokens(
                  input.output,
                  port_token,
                  module_token,
                )
              },
            )
          let module_datum = transfer_shutdown.module_datum(input.output)
          and {
            module_datum.escrow_shard_registry_root == empty_escrow_shard_registry_root,
            module_datum.outstanding_voucher_obligation == 0,
            shutdown.burns_token(transaction, module_token),
          }
        } else {
          // The shard policy checks zero deposits, registry deletion and the refund.
          shutdown.burns_only(transaction.mint, escrow_policy)
        }
      }
      _ -> {
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
            CheckClientHistory { subject_token } |
            CheckStagedClientHistory { subject_token } -> subject_token
            _ -> fail
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
        let subject_output =
          validator_utils.find_unique_continuation_output(
            subject_input.output,
            outputs,
            subject_token,
          )
        expect recovered_datum: ClientDatum =
          validator_utils.get_inline_datum(subject_output)
        expect recovered_datum.token == subject_token
        let valid_to =
          validator_utils.get_tx_valid_to(validity_range) * 1_000_000

        when redeemer is {
          ReclaimStateWithdrawal | ReclaimTransferWithdrawal { .. } -> fail
          CheckStagedClientHistory { .. } -> {
            expect spend: staged_client.SpendMultitxClientRedeemer =
              raw_spend_redeemer
            let (witnesses, siblings) =
              when spend is {
                staged_client.FinalizeUpdate {
                  history_witnesses,
                  history_siblings,
                  ..
                } -> (history_witnesses, history_siblings)
                staged_client.FinalizeMisbehaviour { history_witnesses, .. } ->
                  (history_witnesses, [])
                _ -> fail
              }
            expect
              consensus_history.authenticate_witnesses(
                subject_datum,
                witnesses,
                valid_to,
              )
            when
              height.compare(
                recovered_datum.state.client_state.latest_height,
                subject_datum.state.client_state.latest_height,
              )
            is {
              Greater ->
                preserve_checkpoint(subject_datum, recovered_datum, siblings)
              Equal ->
                siblings == [] && recovered_datum.history_root == subject_datum.history_root
              Less -> False
            }
          }
          CheckClientHistory { .. } -> {
            expect spend_redeemer: SpendClientRedeemer = raw_spend_redeemer
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
            let (spend_substitute_token, history_siblings) =
              if builtin.fst_pair(builtin.un_constr_data(raw_spend_redeemer)) == 1 {
                expect RecoverClient { substitute_token, history_siblings }: SpendClientRedeemer =
                  raw_spend_redeemer
                (substitute_token, history_siblings)
              } else {
                expect staged_client.RecoverClient {
                  substitute_token,
                  history_siblings,
                }: staged_client.SpendMultitxClientRedeemer = raw_spend_redeemer
                (substitute_token, history_siblings)
              }
            expect spend_substitute_token == substitute_token

            expect [substitute_input] =
              list.filter(
                reference_inputs,
                fn(input) {
                  auth.contain_auth_token(input.output, substitute_token)
                },
              )
            expect
              substitute_input.output.address == subject_input.output.address
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
              preserve_checkpoint(
                subject_datum,
                recovered_datum,
                history_siblings,
              ),
              client_datum_mod.recover_state(
                subject_datum,
                substitute_datum,
                recovered_datum,
              ),
            }
          }
        }
      }
    }
  }

  publish(_redeemer: Void, certificate: Certificate, transaction: Transaction) {
    expect UnregisterCredential { .. } = certificate
    expect _ = shutdown.authority(transaction, host_state_nft_policy_id)
    True
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
