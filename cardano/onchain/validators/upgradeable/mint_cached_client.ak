use aiken/collection/dict
use aiken/collection/list
use cardano/assets
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/implementation/minting_client_stt
use ibc/migration/auth as migration
use ibc/migration/types.{client_role}

validator mint_cached_client(
  registry_policy: ByteArray,
  cache_policy: ByteArray,
) {
  mint(redeemer: Data, policy: ByteArray, tx: Transaction) {
    let registry = migration.active_registry(tx, registry_policy)
    expect !registry.preparing
    expect registry.identity.client_policy == policy
    expect migration.no_burn(tx, policy)
    expect migration.creation_address(tx, registry.current, client_role)
    expect
      minting_client_stt.validate_create(
        migration.active_role_hash(registry.current, client_role),
        registry.host_policy,
        redeemer,
        policy,
        tx,
      )
    list.all(
      dict.to_pairs(assets.tokens(tx.mint, policy)),
      fn(entry) {
        assets.quantity_of(
          tx.mint,
          cache_policy,
          identity.token_name(AuthToken { policy_id: policy, name: entry.1st }),
        ) == entry.2nd
      },
    )
  }

  else(_) {
    fail
  }
}
