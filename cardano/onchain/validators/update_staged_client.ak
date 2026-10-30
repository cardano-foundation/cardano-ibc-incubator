use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate}
use cardano/transaction.{Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckStagedClientHistory, RecoverClientWithdrawalRedeemer,
} as legacy_client_redeemer
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  FinalizeMisbehaviour, FinalizeUpdate, SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_multitx_client
use ibc/utils/forwarding
use ibc/utils/validator_utils

/// Ordinary updates and evidence share one authenticated history/state check.
/// Administrative recovery and upgrades remain in their existing credential.
validator update_staged_client(
  host_policy: PolicyId,
  session_policy: PolicyId,
  administrative_script: ByteArray,
) {
  withdraw(
    redeemer: RecoverClientWithdrawalRedeemer,
    credential: Credential,
    transaction: Transaction,
  ) {
    expect CheckStagedClientHistory { subject_token } = redeemer
    let raw: Data = redeemer
    expect forwarding.require_zero(credential, raw, transaction)
    expect [input] =
      list.filter(
        transaction.inputs,
        fn(input) { auth.contain_auth_token(input.output, subject_token) },
      )
    expect datum: ClientDatum = validator_utils.get_inline_datum(input.output)
    expect datum.token == subject_token
    expect Some(raw_spend) =
      pairs.get_first(transaction.redeemers, Spend(input.output_reference))
    expect spend: SpendMultitxClientRedeemer = raw_spend
    expect
      when spend is {
        FinalizeUpdate { .. } | FinalizeMisbehaviour { .. } -> True
        _ -> False
      }
    spending_multitx_client.validate(
      False,
      host_policy,
      session_policy,
      credential,
      Some(datum),
      spend,
      input.output_reference,
      transaction,
    )
  }

  publish(_redeemer: Void, certificate: Certificate, transaction: Transaction) {
    forwarding.deregister_with(administrative_script, certificate, transaction)
  }

  else(_) {
    fail
  }
}
