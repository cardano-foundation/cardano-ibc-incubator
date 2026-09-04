use ibc/auth.{AuthToken}

/// Redeemer for the multi-transaction Tendermint client deployment.
///
/// A normal header and its validator arrays never appear here. They are
/// verified by the authenticated session before this final client spend.
pub type SpendMultitxClientRedeemer {
  FinalizeUpdate { session_token: AuthToken }
  /// Reserved constructor. Direct, single-transaction updates are not
  /// accepted by this deployment.
  DirectUpdateDisabled
}
