use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/header.{Header}

pub type MintClientRedeemer {
  handler_auth_token: AuthToken,
}

pub type SpendClientRedeemer {
  UpdateClient { header: Header }
  Other
}
