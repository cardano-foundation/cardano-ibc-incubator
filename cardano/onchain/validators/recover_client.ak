use aiken/collection/list
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate, UnregisterCredential}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/recovery
use ibc/utils/shutdown

validator recover_client(
  host_state_nft_policy_id: PolicyId,
  upgrade_proof_policy: PolicyId,
) {
  withdraw(
    redeemer: RecoverClientWithdrawalRedeemer,
    _credential: Credential,
    transaction: Transaction,
  ) {
    recovery.validate(
      host_state_nft_policy_id,
      upgrade_proof_policy,
      redeemer,
      transaction,
      fn(host, tx) { list.has(tx.extra_signatories, host.deployer) },
    )
  }

  publish(_redeemer: Void, certificate: Certificate, transaction: Transaction) {
    expect UnregisterCredential { .. } = certificate
    expect _ = shutdown.authority(transaction, host_state_nft_policy_id)
    True
  }

  else(_) {
    fail
  }
}
