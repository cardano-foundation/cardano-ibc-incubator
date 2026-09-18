use cardano/transaction.{Transaction}
use ibc/implementation/minting_connection_stt
use ibc/migration/auth as migration
use ibc/migration/types.{connection_role}

validator mint_connection(registry_policy: ByteArray, proof_policy: ByteArray) {
  mint(redeemer: Data, policy: ByteArray, transaction: Transaction) {
    let registry = migration.active_registry(transaction, registry_policy)
    expect !registry.preparing
    expect registry.identity.connection_policy == policy
    expect migration.no_burn(transaction, policy)
    expect
      migration.creation_address(transaction, registry.current, connection_role)
    minting_connection_stt.validate_create(
      registry.identity.client_policy,
      proof_policy,
      migration.active_role_hash(registry.current, connection_role),
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
