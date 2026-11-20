use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate, UnregisterCredential}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClientWithdrawal, RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/recovery
use ibc/migration/auth as migration
use ibc/utils/shutdown

validator governance_recover_client(
  host_state_nft_policy_id: PolicyId,
  upgrade_proof_policy: PolicyId,
  registry_policy: PolicyId,
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
      fn(host, tx) {
        expect RecoverClientWithdrawal { subject_token, substitute_token } =
          redeemer
        migration.client_recovery_approved(
          tx,
          registry_policy,
          host.nft_policy,
          subject_token,
          substitute_token,
        )
      },
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
