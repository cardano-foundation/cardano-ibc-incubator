use aiken/builtin
use cardano/address.{Credential, Script}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/roster_update
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/implementation/spending_cached_client
use ibc/utils/forwarding

/// Opt-in fresh-deployment wrapper. Existing direct, full and staged routes are
/// retained. Tag seven pins a distinct verifier and the controlled roster policy.
validator roster_client(
  host_policy: ByteArray,
  staged_script: ByteArray,
  cached_script: ByteArray,
  cache_policy: ByteArray,
  recovery: Credential,
  roster_policy: ByteArray,
  roster_script: ByteArray,
) {
  spend(
    datum: Option<ClientDatum>,
    raw: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    if builtin.un_constr_data(raw).1st == 7 {
      expect Some(datum) = datum
      expect Some(own) = transaction.find_input(tx.inputs, own_ref)
      expect auth.contain_auth_token(own.output, datum.token)
      let token = roster_update.token(raw)
      expect
        token == AuthToken {
          policy_id: roster_policy,
          name: identity.token_name(datum.token),
        }
      let expected: Data = datum.token
      forwarding.require_zero(Script(roster_script), expected, tx)
    } else {
      spending_cached_client.validate(
        True,
        host_policy,
        staged_script,
        cached_script,
        cache_policy,
        recovery,
        datum,
        raw,
        own_ref,
        tx,
      )
    }
  }

  else(_) {
    fail
  }
}
