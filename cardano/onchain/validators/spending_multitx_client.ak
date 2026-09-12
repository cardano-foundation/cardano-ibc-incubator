use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Spend, Transaction, Withdraw}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClientWithdrawal,
} as legacy_client_redeemer
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase, MisbehaviourCase}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  DirectUpdateDisabled, FinalizeMisbehaviour, FinalizeUpdate, RecoverClient,
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

/// Completed sessions authenticate normal headers and conflicting-header
/// evidence. Every transition, including administrative recovery, updates the
/// canonical client and HostState together.
validator spend_multitx_client(
  host_state_nft_policy_id: PolicyId,
  session_mint_policy_id: PolicyId,
  recover_client_credential: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendMultitxClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, validity_range, redeemers, mint, .. } =
      transaction
    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect Some(client_datum) = datum
    expect auth.contain_auth_token(spent_input.output, client_datum.token)
    let updated_output =
      validator_utils.find_unique_continuation_output(
        spent_input.output,
        outputs,
        client_datum.token,
      )
    expect auth.contains_only_auth_tokens(updated_output, [client_datum.token])
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

    when redeemer is {
      DirectUpdateDisabled -> False
      RecoverClient { substitute_token } -> {
        expect Some(withdrawal_redeemer) =
          pairs.get_first(redeemers, Withdraw(recover_client_credential))
        let expected: Data =
          RecoverClientWithdrawal {
            subject_token: client_datum.token,
            substitute_token,
          }
        withdrawal_redeemer == expected
      }
      FinalizeUpdate { session_token } -> {
        let receipt =
          finalized_session(session_token, session_mint_policy_id, transaction)
        let tx_time =
          TxTime {
            valid_from: validator_utils.get_tx_valid_from(validity_range) * 1_000_000,
            valid_to: validator_utils.get_tx_valid_to(validity_range) * 1_000_000,
          }
        expect session.validate_finalization(receipt, client_datum, tx_time)
        expect
          validator_utils.require_exact_marker_mint(
            mint,
            session_mint_policy_id,
            session_token.name,
            -1,
          )
        let header = header_from_plan(receipt.plan)
        if misbehaviour_handle.check_for_misbehaviour(
          HeaderCase(header),
          client_datum.state.consensus_states,
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
            tx_time.valid_from / 1_000_000,
            tx_time.valid_to / 1_000_000,
          )
        }
      }
      FinalizeMisbehaviour { session_token_1, session_token_2 } -> {
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
        expect first.owner == second.owner
        expect
          assets.tokens(mint, session_mint_policy_id) == dict.from_pairs(
            [Pair(session_token_1.name, -1), Pair(session_token_2.name, -1)],
          )
        let tx_time =
          TxTime {
            valid_from: validator_utils.get_tx_valid_from(validity_range) * 1_000_000,
            valid_to: validator_utils.get_tx_valid_to(validity_range) * 1_000_000,
          }
        and {
          session.validate_misbehaviour_finalization(
            first,
            client_datum,
            tx_time,
          ),
          session.validate_misbehaviour_finalization(
            second,
            client_datum,
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
            client_datum.state.consensus_states,
          ),
          client_datum_mod.update_state_on_misbehaviour(
            client_datum,
            updated_datum,
          ),
        }
      }
    }
  }

  else(_) {
    fail @"Multi-transaction Tendermint client can only be spent"
  }
}
