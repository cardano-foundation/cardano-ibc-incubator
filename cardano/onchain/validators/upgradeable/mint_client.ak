use cardano/transaction.{Transaction}
use ibc/implementation/minting_client_stt
use ibc/migration/auth as migration
use ibc/migration/types.{client_role}
use ibc/utils/shutdown

validator mint_client(registry_policy: ByteArray) {
  mint(redeemer: Data, policy: ByteArray, transaction: Transaction) {
    let registry = migration.active_registry(transaction, registry_policy)
    expect !registry.preparing
    expect registry.identity.client_policy == policy
    expect
      shutdown.burns_only(transaction.mint, policy) || migration.creation_address(
        transaction,
        registry.current,
        client_role,
      )
    minting_client_stt.validate(
      True,
      migration.active_role_hash(registry.current, client_role),
      registry.host_policy,
      redeemer,
      policy,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
