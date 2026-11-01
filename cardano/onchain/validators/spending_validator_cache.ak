use aiken/collection/list
use aiken/collection/pairs
use cardano/assets
use cardano/transaction.{OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum, Record}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  CachedUpdate, FinalizeUpdate, SpendMultitxClientRedeemer,
}
use ibc/client/ics_007_tendermint_client/multitx/types.{Complete,
  SessionDatum} as session_types
use ibc/utils/validator_utils

/// The client at the address captured on admission authenticates every cache
/// transition. Its pinned verifier checks this input and the exact continuation.
validator spend_validator_cache(session_policy: ByteArray) {
  spend(
    datum: Option<CacheDatum>,
    _redeemer: Void,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum
    expect Some(own) = transaction.find_input(tx.inputs, own_ref)
    expect auth.contain_auth_token(own.output, datum.token)
    if assets.quantity_of(
      tx.mint,
      datum.client_token.policy_id,
      datum.client_token.name,
    ) == -1 {
      // The client policy authorizes retirement. Its cache burns with it.
      assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == -1
    } else {
      expect [client] =
        list.filter(
          tx.inputs,
          fn(input) {
            auth.contain_auth_token(input.output, datum.client_token)
          },
        )
      expect client.output.address == datum.client_address
      expect Some(raw) =
        pairs.get_first(tx.redeemers, Spend(client.output_reference))
      expect action: SpendMultitxClientRedeemer = raw
      when action is {
        CachedUpdate { update } -> update.cache_token == datum.token
        FinalizeUpdate { session_token, .. } -> {
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
          expect Complete { target_root, target_total_power, .. } =
            receipt.phase
          let record =
            Record {
              root: target_root,
              count: receipt.plan.target_validator_count,
              total_power: target_total_power,
            }
          let continuation =
            validator_utils.find_unique_continuation_output(
              own.output,
              tx.outputs,
              datum.token,
            )
          expect next: CacheDatum =
            validator_utils.get_inline_datum(continuation)
          and {
            assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == 0,
            assets.quantity_of(tx.mint, session_policy, session_token.name) == -1,
            next == CacheDatum {
              ..datum,
              records: verify.rotate(datum.records, record),
            },
          }
        }
        _ -> False
      }
    }
  }

  else(_) {
    fail
  }
}
