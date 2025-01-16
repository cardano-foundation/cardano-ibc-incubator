use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour}

pub type ClientMessage {
  HeaderCase(Header)
  MisbehaviourCase(Misbehaviour)
}
