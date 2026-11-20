use cardano/transaction.{Transaction}
use ibc/implementation/minting_cached_client as implementation
use ibc/migration/auth as migration
use ibc/migration/types.{client_role}
use ibc/utils/shutdown

validator mint_cached_client(
  registry_policy: ByteArray,
  cache_policy: ByteArray,
) {
  mint(redeemer: Data, policy: ByteArray, tx: Transaction) {
    let registry = migration.active_registry(tx, registry_policy)
    expect !registry.preparing
    expect registry.identity.client_policy == policy
    expect
      shutdown.burns_only(tx.mint, policy) || migration.creation_address(
        tx,
        registry.current,
        client_role,
      )
    implementation.validate(
      migration.active_role_hash(registry.current, client_role),
      registry.host_policy,
      cache_policy,
      redeemer,
      policy,
      tx,
    )
  }

  else(_) {
    fail
  }
}
