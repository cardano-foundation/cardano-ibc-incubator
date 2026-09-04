use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId, tokens}
use cardano/transaction.{Input, Output, OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  Cancel, Finalize, SessionDatum, SpendSessionRedeemer, VerifyTarget,
  VerifyTrusted,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HostStateRedeemer, UpdateClient,
}
use ibc/utils/validator_utils

fn carries_token(input: Input, token: auth.AuthToken) -> Bool {
  auth.contain_auth_token(input.output, token)
}

fn output_carries_token(output: Output, token: auth.AuthToken) -> Bool {
  auth.contain_auth_token(output, token)
}

fn require_burn(
  datum: SessionDatum,
  outputs: List<Output>,
  transaction: Transaction,
) -> Bool {
  and {
    validator_utils.require_exact_marker_mint(
      transaction.mint,
      datum.session_token.policy_id,
      datum.session_token.name,
      -1,
    ),
    validator_utils.no_output_contains_auth_token(outputs, datum.session_token),
  }
}

fn require_client_continuation(
  datum: SessionDatum,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  expect [client_input] =
    list.filter(
      inputs,
      fn(input) { carries_token(input, datum.plan.client_token) },
    )
  expect [client_output] =
    list.filter(
      outputs,
      fn(output) { output_carries_token(output, datum.plan.client_token) },
    )
  client_input.output.address == client_output.address
}

fn require_host_state_update(
  inputs: List<Input>,
  outputs: List<Output>,
  transaction: Transaction,
  host_state_nft_policy_id: PolicyId,
) -> Bool {
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
  expect [host_output] =
    list.filter(
      outputs,
      fn(output) {
        assets.has_nft(
          output.value,
          host_state_nft_policy_id,
          host_state_token_name,
        )
      },
    )
  expect Some(raw_redeemer) =
    pairs.get_first(transaction.redeemers, Spend(host_input.output_reference))
  expect host_redeemer: HostStateRedeemer = raw_redeemer
  expect UpdateClient { .. } = host_redeemer
  host_input.output.address == host_output.address
}

/// Authenticated accumulator for one normal Tendermint client update.
///
/// The minting policy creates the NFT in an exact initial datum at this script.
/// Every verification step must preserve that NFT and produce the unique datum
/// computed from the previous state. Finalization/cancellation burn it.
validator spend_tendermint_update_session(host_state_nft_policy_id: PolicyId) {
  spend(
    datum: Option<SessionDatum>,
    redeemer: SpendSessionRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction
    expect Some(datum) = datum
    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect auth.contain_auth_token(spent_input.output, datum.session_token)

    when redeemer is {
      VerifyTrusted { .. } | VerifyTarget { .. } -> {
        // Verification and session creation/burning cannot be combined.
        // Only the session owner may choose the next validator batch. Without
        // this check, a third party could commit a wrong prefix and make the
        // accumulator impossible to complete against the planned root.
        expect list.has(extra_signatories, datum.owner)
        expect tokens(mint, datum.session_token.policy_id) |> dict.is_empty
        let expected_datum = session.advance(datum, redeemer)
        let continuation =
          validator_utils.find_unique_continuation_output(
            spent_input.output,
            outputs,
            datum.session_token,
          )
        expect output_datum: SessionDatum =
          validator_utils.get_inline_datum(continuation)
        and {
          auth.contains_only_auth_tokens(continuation, [datum.session_token]),
          output_datum == expected_datum,
        }
      }
      Finalize -> and {
          list.has(extra_signatories, datum.owner),
          session.is_complete_valid(datum),
          require_burn(datum, outputs, transaction),
          require_client_continuation(datum, inputs, outputs),
          require_host_state_update(
            inputs,
            outputs,
            transaction,
            host_state_nft_policy_id,
          ),
        }
      Cancel -> and {
          list.has(extra_signatories, datum.owner),
          require_burn(datum, outputs, transaction),
        }
    }
  }

  else(_) {
    fail @"Tendermint update session can only be spent"
  }
}
