use aiken/collection/list
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/roster.{
  Close, Datum, Refresh, Spend,
}
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/utils/validator_utils

validator validator_roster(cache_policy: ByteArray) {
  spend(
    datum: Option<Datum>,
    redeemer: Spend,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum
    expect Some(own) = transaction.find_input(tx.inputs, own_ref)
    expect auth.contain_auth_token(own.output, datum.token)
    when redeemer is {
      Close -> {
        expect list.has(tx.extra_signatories, datum.owner)
        expect
          assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == -1
        expect
          validator_utils.no_output_contains_auth_token(tx.outputs, datum.token)
        let paid = list.foldl(
          tx.outputs,
          0,
          fn(output, total) {
            if output.address.payment_credential == VerificationKey(datum.owner) {
              total + assets.lovelace_of(output.value)
            } else {
              total
            }
          },
        )
        paid >= assets.lovelace_of(own.output.value)
      }
      Refresh { orders } -> {
        expect
          assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == 0
        expect [client] = list.filter(
          tx.inputs,
          fn(input) {
            auth.contain_auth_token(input.output, datum.client_token)
          },
        )
        expect client.output.address == datum.client_address
        let cache_token = auth.AuthToken {
          policy_id: cache_policy,
          name: identity.token_name(datum.client_token),
        }
        expect [cache] = list.filter(
          tx.inputs,
          fn(input) { auth.contain_auth_token(input.output, cache_token) },
        )
        let cache_output = validator_utils.find_unique_continuation_output(
          cache.output,
          tx.outputs,
          cache_token,
        )
        expect summary: CacheDatum = validator_utils.get_inline_datum(
          cache_output,
        )
        expect
          summary.client_token == datum.client_token && summary.client_address == datum.client_address
        let output = validator_utils.find_unique_continuation_output(
          own.output,
          tx.outputs,
          datum.token,
        )
        expect output.reference_script == None
        expect next: Datum = validator_utils.get_inline_datum(output)
        and {
          next.token == datum.token,
          next.client_token == datum.client_token,
          next.client_address == datum.client_address,
          next.owner == datum.owner,
          next.records != [],
          roster.admit_changes(
            datum.records,
            next.records,
            summary.records,
            orders,
          ),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
