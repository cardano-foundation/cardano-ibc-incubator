use aiken/collection/dict
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, CreateClient, EnterShutdown, FinalizeShutdown, Heartbeat,
  HostStateRedeemer, UpdateClient,
}
use ibc/implementation/host_state_stt
use ibc/migration/auth as migration
use ibc/migration/types.{
  channel_role, client_role, connection_role, host_role, transfer_role,
}

validator host_state(registry_policy: ByteArray, generation: Int) {
  spend(
    _datum: Option<Data>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else {
      let registry =
        migration.active_spend(
          transaction,
          registry_policy,
          generation,
          host_role,
          own_ref,
        )
      expect
        !registry.preparing || assets.tokens(
          transaction.mint,
          registry.identity.escrow_policy,
        ) == dict.empty
      expect redeemer: HostStateRedeemer = raw
      expect
        when redeemer is {
          Heartbeat -> migration.permitted(registry.restrictions, 4)
          UpdateClient { .. } -> migration.permitted(registry.restrictions, 2)
          CreateClient { .. } ->
            migration.permitted(registry.restrictions, 1) && migration.permitted(
              registry.restrictions,
              2,
            )
          _ -> migration.permitted(registry.restrictions, 1)
        }
      expect
        when redeemer is {
          EnterShutdown { .. } -> False
          FinalizeShutdown -> False
          BindPort { port_id, registration, .. } ->
            if port_id == "transfer" {
              and {
                registration.module_script_hash == migration.active_role_hash(
                  registry.current,
                  transfer_role,
                ),
                migration.creation_address(
                  transaction,
                  registry.current,
                  transfer_role,
                ),
              }
            } else {
              True
            }
          _ -> True
        }
      host_state_stt.validate_live(
        registry.host_policy,
        migration.active_role_hash(registry.current, client_role),
        migration.active_role_hash(registry.current, connection_role),
        migration.active_role_hash(registry.current, channel_role),
        registry.identity.client_policy,
        registry.identity.connection_policy,
        registry.identity.channel_policy,
        None,
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
