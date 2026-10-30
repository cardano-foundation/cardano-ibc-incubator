use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Spend, Transaction, Withdraw}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckStagedClientHistory, RecoverClientWithdrawal, UpgradeClientWithdrawal,
} as legacy_client_redeemer
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase, MisbehaviourCase}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  FinalizeMisbehaviour, FinalizeUpdate, ReclaimClient, RecoverClient,
  SpendMultitxClientRedeemer, UpgradeClient,
}
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  Finalize, SessionDatum, SpendSessionRedeemer, UpdatePlan,
}
use ibc/utils/forwarding
use ibc/utils/tx_time.{TxTime}
use ibc/utils/validator_utils

/// NFT identity binds this input to the subject checked by the forwarded
/// invocation. The ordinary script checks the complete state transition.
pub fn validate_guard(
  allow_retirement: Bool,
  host_policy: PolicyId,
  update_script: ByteArray,
  recovery: Credential,
  datum: Option<ClientDatum>,
  redeemer: SpendMultitxClientRedeemer,
  own_ref: OutputReference,
  transaction: Transaction,
) -> Bool {
  expect Some(datum) = datum
  expect Some(input) = transaction.find_input(transaction.inputs, own_ref)
  expect auth.contain_auth_token(input.output, datum.token)
  when redeemer is {
    ReclaimClient ->
      allow_retirement && assets.quantity_of(
        transaction.mint,
        datum.token.policy_id,
        datum.token.name,
      ) == -1
    FinalizeUpdate { .. } | FinalizeMisbehaviour { .. } -> {
      let expected: Data =
        CheckStagedClientHistory { subject_token: datum.token }
      forwarding.require_zero(Script(update_script), expected, transaction)
    }
    RecoverClient { substitute_token, .. } -> {
      expect _ =
        validator_utils.require_host_state_redeemer(
          transaction.inputs,
          transaction.outputs,
          transaction.redeemers,
          host_policy,
          validator_utils.ExpectUpdateClient,
        )
      let expected: Data =
        RecoverClientWithdrawal { subject_token: datum.token, substitute_token }
      forwarding.require_zero(recovery, expected, transaction)
    }
    UpgradeClient -> {
      expect _ =
        validator_utils.require_host_state_redeemer(
          transaction.inputs,
          transaction.outputs,
          transaction.redeemers,
          host_policy,
          validator_utils.ExpectUpdateClient,
        )
      let expected: Data =
        UpgradeClientWithdrawal { subject_token: datum.token }
      forwarding.require_zero(recovery, expected, transaction)
    }
    _ -> False
  }
}

fn validate_history(
  datum: ClientDatum,
  updated: ClientDatum,
  siblings: List<ByteArray>,
) -> Bool {
  when
    height.compare(
      updated.state.client_state.latest_height,
      datum.state.client_state.latest_height,
    )
  is {
    Greater ->
      consensus_history.insert(
        datum.history_root,
        consensus_history.from_client(datum),
        siblings,
      ) == updated.history_root
    Equal -> siblings == [] && updated.history_root == datum.history_root
    Less -> False
  }
}

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
      let valid_to = validator_utils.get_tx_valid_to(validity_range)
      let tx_time =
        TxTime {
          valid_from: validator_utils.get_tx_valid_from(validity_range) * 1_000_000,
          valid_to: valid_to * 1_000_000,
        }
      let withdrawal =
        pairs.get_first(redeemers, Withdraw(recover_client_credential))
      let expected_history: Data =
        CheckStagedClientHistory { subject_token: client_token }
      when redeemer is {
        UpgradeClient -> {
          let expected: Data =
            UpgradeClientWithdrawal { subject_token: client_token }
          withdrawal == Some(expected)
        }
        RecoverClient { substitute_token, .. } -> {
          let expected: Data =
            RecoverClientWithdrawal {
              subject_token: client_token,
              substitute_token,
            }
          withdrawal == Some(expected)
        }
        FinalizeUpdate { session_token, history_witnesses, history_siblings } -> {
          expect withdrawal == Some(expected_history)
          let receipt =
            finalized_session(
              session_token,
              session_mint_policy_id,
              transaction,
            )
          expect validate_history(client_datum, updated_datum, history_siblings)
          let header = header_from_plan(receipt.plan)
          let proof_states =
            consensus_history.consensus_states_for_message(
              client_datum,
              history_witnesses,
              valid_to * 1_000_000,
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
          expect
            session.validate_finalization_from_authenticated_plan(
              receipt,
              proof_client,
              tx_time,
            )
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
              valid_to,
            )
          }
        }
        FinalizeMisbehaviour {
          session_token_1,
          session_token_2,
          history_witnesses,
        } -> {
          expect withdrawal == Some(expected_history)
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
            consensus_history.consensus_states_for_message(
              client_datum,
              history_witnesses,
              valid_to * 1_000_000,
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
          expect validate_history(client_datum, updated_datum, [])
          expect first.owner == second.owner
          // Both distinct session tokens were authenticated above, including
          // their policy and exact -1 quantities. Two entries under that
          // policy therefore exclude any additional mint or burn.
          expect [_,
            _] =
            mint
              |> assets.tokens(session_mint_policy_id)
              |> dict.to_pairs()
          and {
            session.validate_misbehaviour_finalization_from_authenticated_plan(
              first,
              proof_client,
              tx_time,
            ),
            session.validate_misbehaviour_finalization_from_authenticated_plan(
              second,
              proof_client,
              tx_time,
            ),
            misbehaviour_handle.check_for_misbehaviour(msg, proof_states),
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
