use cardano/address.{Credential}
use cardano/transaction.{OutputReference, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  ReclaimClient, SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_multitx_client
use ibc/migration/auth as migration

validator client(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  session_policy: ByteArray,
  recovery: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else {
      // Ordinary operations consume HostState, whose current registry gate
      // authenticates phase and role compatibility. Migration has a separate path.
      expect
        migration.operation_allowed(transaction, registry_policy, generation, 2)
      expect redeemer: SpendMultitxClientRedeemer = raw
      expect redeemer != ReclaimClient
      spending_multitx_client.validate(
        False,
        host_policy,
        session_policy,
        recovery,
        datum,
        redeemer,
        own_ref,
        transaction,
      )
    }
  }

  else(_) {
    fail
  }
}
