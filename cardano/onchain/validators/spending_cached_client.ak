use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/implementation/spending_cached_client

/// Direct updates share the client with staged and administrative operations.
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

  else(_) {
    fail
  }
}
