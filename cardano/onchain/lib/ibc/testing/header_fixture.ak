use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

// Data shape of captured header fixtures, never accepted by a deployed validator.
pub type HeaderFixture {
  UpdateClient {
    msg: ClientMessage,
    history_witnesses: List<Witness>,
    history_siblings: List<ByteArray>,
  }
}
