use aiken/crypto.{VerificationKeyHash}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub type MintClientRedeemer {
  MintClient
  BurnClient { token: AuthToken, reclaim_to: VerificationKeyHash }
}

pub type SpendClientRedeemer {
  UpdateClient { msg: ClientMessage }
  Other
  PruneTerminalConsensusStates
  ReclaimClient { reclaim_to: VerificationKeyHash }
}
