use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  OutputReference, Redeemer, ScriptPurpose, Spend, Transaction, Withdraw,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckStagedClientHistory, RecoverClientWithdrawal,
} as legacy_client_redeemer
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase, MisbehaviourCase}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  FinalizeMisbehaviour, FinalizeUpdate, ReclaimClient, RecoverClient,
  SpendMultitxClientRedeemer,
}
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  Finalize, SessionDatum, SpendSessionRedeemer, UpdatePlan,
}
use ibc/utils/tx_time.{TxTime}
use ibc/utils/validator_utils

fn header_from_plan(plan: UpdatePlan) -> Header {
  Header {
    signed_header: SignedHeader {
      header: plan.header,
      // The session already verified signatures. Only the committed header
      // fields are used for conflict detection and the client transition.
      commit: Commit {
        height: plan.commit.height,
        round: plan.commit.round,
        block_id: plan.commit.block_id,
        signatures: [],
      },
    },
    validator_set: validator_set.null_validator_set(),
    trusted_height: plan.trusted_height,
    trusted_validators: validator_set.null_validator_set(),
  }
}

fn finalized_session(
  token: AuthToken,
  session_policy: PolicyId,
  transaction: Transaction,
) -> SessionDatum {
  expect token.policy_id == session_policy
  expect [input] =
    list.filter(
      transaction.inputs,
      fn(input) { auth.contain_auth_token(input.output, token) },
    )
  expect datum: SessionDatum = validator_utils.get_inline_datum(input.output)
  expect datum.session_token == token
  expect Some(raw) =
    pairs.get_first(transaction.redeemers, Spend(input.output_reference))
  expect redeemer: SpendSessionRedeemer = raw
  expect Finalize = redeemer
  expect assets.quantity_of(transaction.mint, session_policy, token.name) == -1
  expect
    validator_utils.no_output_contains_auth_token(transaction.outputs, token)
  datum
}

fn expect_history_withdrawal(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  credential: Credential,
  token: AuthToken,
) -> Bool {
  expect Some(raw) = pairs.get_first(redeemers, Withdraw(credential))
  let expected: Data = CheckStagedClientHistory { subject_token: token }
  expect raw == expected
  True
}

/// Completed sessions authenticate normal headers and conflicting-header
/// evidence. Every client update, including administrative recovery, updates the
/// canonical client and HostState together.
pub fn validate(
  allow_retirement: Bool,
  host_state_nft_policy_id: PolicyId,
  session_mint_policy_id: PolicyId,
  recover_client_credential: Credential,
  datum: Option<ClientDatum>,
  redeemer: SpendMultitxClientRedeemer,
  spent_output_ref: OutputReference,
  transaction: Transaction,
) -> Bool {
  let Transaction { inputs, outputs, validity_range, redeemers, mint, .. } =
    transaction
  expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
  expect Some(client_datum) = datum
  let client_token = client_datum.token
  expect auth.contain_auth_token(spent_input.output, client_token)
  when redeemer is {
    ReclaimClient ->
      // The state-token policy enforces shutdown authority, grace and refunds.
      allow_retirement && assets.quantity_of(
        mint,
        client_token.policy_id,
        client_token.name,
      ) == -1
    _ -> {
      expect client_datum_mod.has_singleton_history(client_datum)
      let updated_output =
        validator_utils.find_unique_continuation_output(
          spent_input.output,
          outputs,
          client_token,
        )
      expect updated_datum: ClientDatum =
        validator_utils.get_inline_datum(updated_output)
      let (_, _) =
        validator_utils.require_host_state_redeemer(
          inputs,
          outputs,
          redeemers,
          host_state_nft_policy_id,
          validator_utils.ExpectUpdateClient,
        )
      let tx_time =
        TxTime {
          valid_from: validator_utils.get_tx_valid_from(validity_range) * 1_000_000,
          valid_to: validator_utils.get_tx_valid_to(validity_range) * 1_000_000,
        }
      when redeemer is {
        RecoverClient { substitute_token, .. } -> {
          expect Some(withdrawal_redeemer) =
            pairs.get_first(redeemers, Withdraw(recover_client_credential))
          let expected: Data =
            RecoverClientWithdrawal {
              subject_token: client_token,
              substitute_token,
            }
          withdrawal_redeemer == expected
        }
        FinalizeUpdate { session_token, history_witnesses, .. } -> {
          expect
            expect_history_withdrawal(
              redeemers,
              recover_client_credential,
              client_token,
            )
          let receipt =
            finalized_session(
              session_token,
              session_mint_policy_id,
              transaction,
            )
          let header = header_from_plan(receipt.plan)
          let proof_states =
            consensus_history.message_witness_states(
              client_datum,
              history_witnesses,
              HeaderCase(header),
            )
          let proof_client =
            ClientDatum {
              ..client_datum,
              state: client_datum_mod.ClientDatumState {
                ..client_datum.state,
                consensus_states: proof_states,
              },
            }
          expect session.validate_finalization(receipt, proof_client, tx_time)
          expect
            validator_utils.require_exact_marker_mint(
              mint,
              session_mint_policy_id,
              session_token.name,
              -1,
            )
          if misbehaviour_handle.check_for_misbehaviour(
            HeaderCase(header),
            proof_states,
          ) {
            client_datum_mod.update_state_on_misbehaviour(
              client_datum,
              updated_datum,
            )
          } else {
            client_datum_mod.update_state(
              client_datum,
              updated_datum,
              header,
              tx_time.valid_to / 1_000_000,
            )
          }
        }
        FinalizeMisbehaviour {
          session_token_1,
          session_token_2,
          history_witnesses,
        } -> {
          expect
            expect_history_withdrawal(
              redeemers,
              recover_client_credential,
              client_token,
            )
          expect session_token_1 != session_token_2
          let first =
            finalized_session(
              session_token_1,
              session_mint_policy_id,
              transaction,
            )
          let second =
            finalized_session(
              session_token_2,
              session_mint_policy_id,
              transaction,
            )
          let msg =
            MisbehaviourCase(
              Misbehaviour {
                client_id: #"",
                header1: header_from_plan(first.plan),
                header2: header_from_plan(second.plan),
              },
            )
          let proof_states =
            consensus_history.message_witness_states(
              client_datum,
              history_witnesses,
              msg,
            )
          let proof_client =
            ClientDatum {
              ..client_datum,
              state: client_datum_mod.ClientDatumState {
                ..client_datum.state,
                consensus_states: proof_states,
              },
            }
          expect first.owner == second.owner
          // Both distinct session tokens were authenticated above, including
          // their policy and exact -1 quantities. Two entries under that
          // policy therefore exclude any additional mint or burn.
          expect [_,
            _] =
            mint |> assets.tokens(session_mint_policy_id) |> dict.to_pairs()
          and {
            session.validate_misbehaviour_finalization(
              first,
              proof_client,
              tx_time,
            ),
            session.validate_misbehaviour_finalization(
              second,
              proof_client,
              tx_time,
            ),
            misbehaviour_handle.check_for_misbehaviour(
              MisbehaviourCase(
                Misbehaviour {
                  // Client identity is bound by both authenticated plans.
                  client_id: #"",
                  header1: header_from_plan(first.plan),
                  header2: header_from_plan(second.plan),
                },
              ),
              proof_states,
            ),
            client_datum_mod.update_state_on_misbehaviour(
              client_datum,
              updated_datum,
            ),
          }
        }
        _ -> False
      }
    }
  }
}
