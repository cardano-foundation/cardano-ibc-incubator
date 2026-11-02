use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  RecoverClient, SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_cached_client
use ibc/migration/auth as migration

validator cached_client(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  staged_script: ByteArray,
  cached_script: ByteArray,
  cache_policy: ByteArray,
  recovery: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      expect Some(datum) = datum
      let token = AuthToken {
        policy_id: cache_policy,
        name: identity.token_name(datum.token),
      }
      expect [_] = list.filter(
        transaction.inputs,
        fn(input) { auth.contain_auth_token(input.output, token) },
      )
      migration.migration_witness(transaction, registry_policy)
    } else {
      let references = if builtin.un_constr_data(raw).1st == 6 {
        transaction.reference_inputs
      } else {
        expect redeemer: SpendMultitxClientRedeemer = raw
        when redeemer is {
          RecoverClient { .. } ->
            migration.recovery_registry_inputs(transaction, registry_policy)
          _ -> transaction.reference_inputs
        }
      }
      expect
        migration.operation_allowed_from_inputs(
          references,
          registry_policy,
          generation,
          2,
        )
      spending_cached_client.validate(
        False,
        host_policy,
        staged_script,
        cached_script,
        cache_policy,
        recovery,
        datum,
        raw,
        own_ref,
        transaction,
      )
    }
  }

  else(_) {
    fail
  }
}
