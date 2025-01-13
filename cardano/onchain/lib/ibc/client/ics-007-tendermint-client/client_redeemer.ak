use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub type MintClientRedeemer {
  handler_auth_token: AuthToken,
}

pub type SpendClientRedeemer {
  UpdateClient { msg: ClientMessage }
  Other
}
