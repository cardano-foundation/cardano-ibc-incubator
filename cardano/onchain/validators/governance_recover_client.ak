use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  ReclaimStateWithdrawal, ReclaimTransferWithdrawal, RecoverClientWithdrawal,
  RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/recovery
use ibc/migration/auth as migration

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
    // Upgradeable deployments do not permit the legacy shutdown path.
    expect redeemer != ReclaimStateWithdrawal
    expect
      when redeemer is {
        ReclaimTransferWithdrawal { .. } -> False
        _ -> True
      }
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

  else(_) {
    fail
  }
}
