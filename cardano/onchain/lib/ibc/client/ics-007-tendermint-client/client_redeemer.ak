use ibc/auth.{AuthToken}

pub type MintClientRedeemer {
  MintClient
}

/// The existing recovery credential also authenticates update history. Keeping
/// this support work outside spend_client fits each deployable reference script
/// within the transaction-size limit. Spends bind the exact branch and identities.
pub type RecoverClientWithdrawalRedeemer {
  RecoverClientWithdrawal {
    subject_token: AuthToken,
    substitute_token: AuthToken,
  }
  DirectHistoryDisabled
  ReclaimStateWithdrawal
  ReclaimTransferWithdrawal {
    port_unit: ByteArray,
    module_unit: ByteArray,
    escrow_policy: ByteArray,
  }
  CheckStagedClientHistory { subject_token: AuthToken }
  UpgradeClientWithdrawal { subject_token: AuthToken }
}
