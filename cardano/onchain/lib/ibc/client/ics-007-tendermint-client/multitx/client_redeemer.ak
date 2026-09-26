use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}

/// Redeemer for the multi-transaction Tendermint client deployment.
///
/// A normal header and its validator arrays never appear here. They are
/// verified by the authenticated session before this final client spend.
pub type SpendMultitxClientRedeemer {
  FinalizeUpdate {
    session_token: AuthToken,
    history_witnesses: List<Witness>,
    history_siblings: List<ByteArray>,
  }
  /// Reserved constructor. Direct, single-transaction updates are not
  /// accepted by this deployment.
  DirectUpdateDisabled
  RecoverClient {
    substitute_token: AuthToken,
    history_siblings: List<ByteArray>,
  }
  FinalizeMisbehaviour {
    session_token_1: AuthToken,
    session_token_2: AuthToken,
    history_witnesses: List<Witness>,
  }
  /// Deployment shutdown only; authorization and refunds are enforced by the state-token policy.
  ReclaimClient
  UpgradeClient
}
