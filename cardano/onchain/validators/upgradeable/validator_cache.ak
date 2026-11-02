use aiken/collection/list
use aiken/collection/pairs
use cardano/assets
use cardano/transaction.{OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/implementation/spending_validator_cache
use ibc/migration/auth as migration
use ibc/utils/validator_utils

validator validator_cache(
  registry_policy: ByteArray,
  session_policy: ByteArray,
  cached_script: ByteArray,
  staged_script: ByteArray,
) {
  spend(
    datum: Option<CacheDatum>,
    raw: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    if migration.is_migration(raw) {
      expect migration.migration_witness(tx, registry_policy)
      expect Some(datum) = datum
      expect Some(own) = transaction.find_input(tx.inputs, own_ref)
      expect auth.contain_auth_token(own.output, datum.token)
      expect datum.token.name == identity.token_name(datum.client_token)
      expect
        assets.quantity_of(tx.mint, datum.token.policy_id, datum.token.name) == 0
      expect [client] =
        list.filter(
          tx.inputs,
          fn(input) {
            auth.contain_auth_token(input.output, datum.client_token)
          },
        )
      expect client.output.address == datum.client_address
      expect Some(client_redeemer) =
        pairs.get_first(tx.redeemers, Spend(client.output_reference))
      expect migration.is_migration(client_redeemer)
      expect [output] =
        list.filter(
          tx.outputs,
          fn(output) { auth.contain_auth_token(output, datum.client_token) },
        )
      // Registry validation authenticates the exact destination and preserves
      // the client datum. The cache moves its binding in that same transaction.
      let continuation =
        validator_utils.find_unique_continuation_output(
          own.output,
          tx.outputs,
          datum.token,
        )
      expect next: CacheDatum = validator_utils.get_inline_datum(continuation)
      next == CacheDatum { ..datum, client_address: output.address }
    } else {
      expect redeemer: Void = raw
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
  }

  else(_) {
    fail
  }
}
