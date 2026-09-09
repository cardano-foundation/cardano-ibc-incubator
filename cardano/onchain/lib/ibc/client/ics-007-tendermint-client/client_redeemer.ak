use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub type MintClientRedeemer {
  MintClient
  ArchiveConsensusState { client_token: AuthToken }
  PruneConsensusState { client_token: AuthToken, height: Height }
}

pub type SpendClientRedeemer {
  UpdateClient { msg: ClientMessage }
  RecoverClient { substitute_token: AuthToken }
}

/// The recovery withdrawal validator receives both client identities so it can
/// validate the full state transition without being coupled to spend_client's
/// script hash.
pub type RecoverClientWithdrawalRedeemer {
  RecoverClientWithdrawal {
    subject_token: AuthToken,
    substitute_token: AuthToken,
  }
}
