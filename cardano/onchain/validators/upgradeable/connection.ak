use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ReclaimConnection, SpendConnectionRedeemer,
}
use ibc/implementation/spending_connection
use ibc/migration/auth as migration

validator connection(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  client_policy: ByteArray,
  proof_policy: ByteArray,
) {
  spend(
    datum: Option<ConnectionDatum>,
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
        migration.operation_allowed(transaction, registry_policy, generation, 1)
      expect redeemer: SpendConnectionRedeemer = raw
      expect redeemer != ReclaimConnection
      spending_connection.validate(
        False,
        client_policy,
        proof_policy,
        host_policy,
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
