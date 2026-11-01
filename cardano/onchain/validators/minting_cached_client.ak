use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/retirement
use ibc/implementation/minting_client_stt
use ibc/utils/shutdown

/// A cached client always creates and retires its one canonical cache with it.
validator mint_cached_client(
  client_script: ByteArray,
  host_policy: PolicyId,
  cache_policy: PolicyId,
) {
  mint(redeemer: Data, policy: PolicyId, tx: Transaction) {
    expect
      if shutdown.burns_only(tx.mint, policy) {
        retirement.validate(
          client_script,
          host_policy,
          cache_policy,
          policy,
          tx,
        )
      } else {
        minting_client_stt.validate_create(
          client_script,
          host_policy,
          redeemer,
          policy,
          tx,
        )
      }
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
