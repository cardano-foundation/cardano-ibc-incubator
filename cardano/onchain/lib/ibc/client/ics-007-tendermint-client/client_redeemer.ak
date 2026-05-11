use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub type MintClientRedeemer {
  MintClient
}

pub type SpendClientRedeemer {
  UpdateClient { msg: ClientMessage }
  Other
}
