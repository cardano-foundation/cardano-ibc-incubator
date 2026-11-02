use cardano/transaction.{OutputReference, Transaction}
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/implementation/spending_validator_cache

/// Every continuation preserves the admitted identity and invokes a pinned
/// verifier. The captured client address alone cannot authorize changes.
validator spend_validator_cache(
  session_policy: ByteArray,
  cached_script: ByteArray,
  staged_script: ByteArray,
) {
  spend(
    datum: Option<CacheDatum>,
    redeemer: Void,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    spending_validator_cache.validate(
      session_policy,
      cached_script,
      staged_script,
      datum,
      redeemer,
      own_ref,
      tx,
    )
  }

  else(_) {
    fail
  }
}
