use cardano/address.{Credential}
use cardano/transaction.{OutputReference, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  RecoverClient, SpendMultitxClientRedeemer,
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
      expect redeemer: SpendMultitxClientRedeemer = raw
      let references =
        when redeemer is {
          RecoverClient { .. } ->
            migration.recovery_registry_inputs(transaction, registry_policy)
          _ -> transaction.reference_inputs
        }
      expect
        migration.operation_allowed_from_inputs(
          references,
          registry_policy,
          generation,
          2,
        )
      // validate(False, ...) rejects retirement in this wrapper.
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
