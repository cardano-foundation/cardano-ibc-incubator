use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  IBCModuleRedeemer, ReclaimModule,
}
use ibc/implementation/spending_transfer_module
use ibc/migration/auth as migration

validator transfer(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  channel_policy: ByteArray,
  escrow_policy: ByteArray,
  port_token: AuthToken,
  module_token: AuthToken,
  voucher_policy: ByteArray,
  shutdown_hash: ByteArray,
) {
  spend(
    datum: Option<Data>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else {
      // Ordinary operations consume HostState, whose current registry gate
      // authenticates phase and role compatibility. Migration has a separate path.
      expect generation > 0
      expect redeemer: IBCModuleRedeemer = raw
      expect redeemer != ReclaimModule
      spending_transfer_module.validate(
        False,
        port_token,
        module_token,
        "transfer",
        escrow_policy,
        channel_policy,
        voucher_policy,
        host_policy,
        shutdown_hash,
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
