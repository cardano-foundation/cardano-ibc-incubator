use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum} as client_datum_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  DirectUpdateDisabled, FinalizeUpdate, SpendMultitxClientRedeemer,
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
      // Signatures were consumed by the preceding session transactions. The
      // ordinary state-transition helper uses only the header fields.
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

/// Canonical client validator for the staged Tendermint protocol.
///
/// Verification transactions only advance a temporary session NFT. This
/// validator accepts the completed receipt, repeats every live-client/time
/// check, burns the receipt, and performs the ordinary atomic client and
/// HostState transition.
validator spend_multitx_client(
  host_state_nft_policy_id: PolicyId,
  session_mint_policy_id: PolicyId,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendMultitxClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when redeemer is {
      DirectUpdateDisabled -> False
      FinalizeUpdate { session_token } -> {
        let Transaction { inputs, outputs, validity_range, redeemers, mint, .. } =
          transaction
        expect session_token.policy_id == session_mint_policy_id

        expect [session_input] =
          list.filter(
            inputs,
            fn(input) { auth.contain_auth_token(input.output, session_token) },
          )
        expect session_datum: SessionDatum =
          validator_utils.get_inline_datum(session_input.output)
        expect session_datum.session_token == session_token
        expect Some(raw_session_redeemer) =
          pairs.get_first(redeemers, Spend(session_input.output_reference))
        expect session_redeemer: SpendSessionRedeemer = raw_session_redeemer
        expect Finalize = session_redeemer

        expect Some(spent_input) =
          transaction.find_input(inputs, spent_output_ref)
        expect Some(client_datum) = datum
        expect auth.contain_auth_token(spent_input.output, client_datum.token)
        let updated_output =
          validator_utils.find_unique_continuation_output(
            spent_input.output,
            outputs,
            client_datum.token,
          )
        expect
          auth.contains_only_auth_tokens(updated_output, [client_datum.token])
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

        let tx_valid_from =
          validator_utils.get_tx_valid_from(validity_range) * 1_000_000
        let tx_valid_to =
          validator_utils.get_tx_valid_to(validity_range) * 1_000_000
        let tx_time =
          TxTime { valid_from: tx_valid_from, valid_to: tx_valid_to }

        and {
          session.validate_finalization(session_datum, client_datum, tx_time),
          validator_utils.require_exact_marker_mint(
            mint,
            session_token.policy_id,
            session_token.name,
            -1,
          ),
          validator_utils.no_output_contains_auth_token(outputs, session_token),
          client_datum_mod.update_state(
            client_datum,
            updated_datum,
            header_from_plan(session_datum.plan),
            // A staged chain can remain valid for many minutes. Recording its
            // lower bound would let a later proof count time spent building
            // the chain toward the IBC delay period. The upper bound is at or
            // after actual inclusion, so it is conservative for both delay
            // time and the derived delay height.
            tx_valid_to / 1_000_000,
          ),
        }
      }
    }
  }

  else(_) {
    fail @"Multi-transaction Tendermint client can only be spent"
  }
}
