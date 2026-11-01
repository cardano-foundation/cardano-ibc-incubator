use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum, Record}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckStagedClientHistory,
} as legacy_redeemer
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  FinalizeUpdate, SpendMultitxClientRedeemer,
}
use ibc/client/ics_007_tendermint_client/multitx/types.{Complete,
  SessionDatum} as session_types
use ibc/utils/forwarding
use ibc/utils/validator_utils

/// Every continuation preserves the admitted identity and invokes a pinned
/// verifier. The captured client address alone cannot authorize changes.
validator spend_validator_cache(
  session_policy: ByteArray,
  cached_script: ByteArray,
  staged_script: ByteArray,
) {
  spend(
    datum: Option<CacheDatum>,
    _redeemer: Void,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum
    expect Some(own) = transaction.find_input(tx.inputs, own_ref)
    expect auth.contain_auth_token(own.output, datum.token)
    expect datum.token.name == identity.token_name(datum.client_token)
    expect [client] =
      list.filter(
        tx.inputs,
        fn(input) { auth.contain_auth_token(input.output, datum.client_token) },
      )
    expect client.output.address == datum.client_address
    if assets.quantity_of(
      tx.mint,
      datum.client_token.policy_id,
      datum.client_token.name,
    ) == -1 {
      // The client policy authorizes retirement. Its cache burns with it.
      assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == -1 && validator_utils.no_output_contains_auth_token(
        tx.outputs,
        datum.token,
      )
    } else {
      expect
        assets.tokens(tx.mint, datum.token.policy_id) == assets.tokens(
          assets.zero,
          datum.token.policy_id,
        )
      let continuation =
        validator_utils.find_unique_continuation_output(
          own.output,
          tx.outputs,
          datum.token,
        )
      expect next: CacheDatum = validator_utils.get_inline_datum(continuation)
      expect identity.preserves(datum, next)
      expect Some(raw) =
        pairs.get_first(tx.redeemers, Spend(client.output_reference))
      if builtin.un_constr_data(raw).1st == 6 {
        let cache_token = identity.update_cache_token(raw)
        let expected: Data = datum.client_token
        cache_token == datum.token && forwarding.require_zero(
          Script(cached_script),
          expected,
          tx,
        )
      } else {
        expect FinalizeUpdate { session_token, .. }: SpendMultitxClientRedeemer =
          raw
        let expected: Data =
          CheckStagedClientHistory { subject_token: datum.client_token }
        expect forwarding.require_zero(Script(staged_script), expected, tx)
        expect session_token.policy_id == session_policy
        expect [session] =
          list.filter(
            tx.inputs,
            fn(input) { auth.contain_auth_token(input.output, session_token) },
          )
        expect receipt: SessionDatum =
          validator_utils.get_inline_datum(session.output)
        expect
          receipt.session_token == session_token && receipt.plan.client_token == datum.client_token
        expect Complete { target_root, target_total_power, .. } = receipt.phase
        let record =
          Record {
            root: target_root,
            count: receipt.plan.target_validator_count,
            total_power: target_total_power,
          }
        and {
          assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == 0,
          assets.quantity_of(tx.mint, session_policy, session_token.name) == -1,
          next == CacheDatum {
            ..datum,
            records: verify.rotate(datum.records, record),
          },
        }
      }
    }
  }

  else(_) {
    fail
  }
}
