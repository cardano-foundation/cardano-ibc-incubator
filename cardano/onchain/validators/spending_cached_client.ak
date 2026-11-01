use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  ReclaimClient, SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_multitx_client
use ibc/utils/forwarding

/// Opt-in deployment with the existing staged and administrative fallbacks.
validator spend_cached_client(
  host_policy: PolicyId,
  staged_script: ByteArray,
  cached_script: ByteArray,
  cache_policy: PolicyId,
  recovery: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    raw: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    if builtin.un_constr_data(raw).1st == 6 {
      let cache_token = identity.update_cache_token(raw)
      expect Some(datum) = datum
      expect Some(input) = transaction.find_input(tx.inputs, own_ref)
      expect auth.contain_auth_token(input.output, datum.token)
      expect
        cache_token == AuthToken {
          policy_id: cache_policy,
          name: identity.token_name(datum.token),
        }
      let subject: Data = datum.token
      forwarding.require_zero(Script(cached_script), subject, tx)
    } else {
      expect redeemer: SpendMultitxClientRedeemer = raw
      expect
        if redeemer == ReclaimClient {
          expect Some(datum) = datum
          let cache_token =
            AuthToken {
              policy_id: cache_policy,
              name: identity.token_name(datum.token),
            }
          expect [_] =
            list.filter(
              tx.inputs,
              fn(input) { auth.contain_auth_token(input.output, cache_token) },
            )
          assets.quantity_of(tx.mint, cache_policy, cache_token.name) == -1
        } else {
          True
        }
      spending_multitx_client.validate_guard(
        True,
        host_policy,
        staged_script,
        recovery,
        datum,
        redeemer,
        own_ref,
        tx,
      )
    }
  }

  else(_) {
    fail
  }
}
