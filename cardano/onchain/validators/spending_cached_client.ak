use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  CachedUpdate, SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_multitx_client
use ibc/utils/forwarding

/// Opt-in deployment with the existing staged and administrative fallbacks.
validator spend_cached_client(
  host_policy: PolicyId,
  staged_script: ByteArray,
  cached_script: ByteArray,
  recovery: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendMultitxClientRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      CachedUpdate { .. } -> {
        expect Some(datum) = datum
        expect Some(input) = transaction.find_input(tx.inputs, own_ref)
        expect auth.contain_auth_token(input.output, datum.token)
        let subject: Data = datum.token
        forwarding.require_zero(Script(cached_script), subject, tx)
      }
      _ ->
        spending_multitx_client.validate_guard(
          True,
          host_policy,
          staged_script,
          recovery,
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
