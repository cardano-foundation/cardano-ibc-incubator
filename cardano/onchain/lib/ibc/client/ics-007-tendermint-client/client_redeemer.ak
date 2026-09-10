use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub type MintClientRedeemer {
  MintClient
}

pub type SpendClientRedeemer {
  UpdateClient {
    msg: ClientMessage,
    history_witnesses: List<Witness>,
    history_siblings: List<ByteArray>,
  }
  RecoverClient {
    substitute_token: AuthToken,
    history_siblings: List<ByteArray>,
  }
}

/// The existing recovery credential also authenticates update history. Keeping
/// this support work outside spend_client fits each deployable reference script
/// within the transaction-size limit. Spends bind the exact branch and identities.
pub type RecoverClientWithdrawalRedeemer {
  RecoverClientWithdrawal {
    subject_token: AuthToken,
    substitute_token: AuthToken,
  }
  CheckClientHistory { subject_token: AuthToken }
}
