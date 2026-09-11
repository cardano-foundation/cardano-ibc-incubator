// Explicit-root adapter retained only for the isolated prototype benchmark.
// Production callers use consensus_history and the authenticated ClientDatum root.
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/consensus_history.{
  ConsensusStateDatum, Witness,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{ClientMessage}

pub fn key(token: AuthToken, height: Height) -> ByteArray {
  consensus_history.key(token, height)
}

pub fn value(record: ConsensusStateDatum) -> ByteArray {
  consensus_history.value(record)
}

pub fn insert(
  root: ByteArray,
  record: ConsensusStateDatum,
  siblings: List<ByteArray>,
) -> ByteArray {
  consensus_history.insert(root, record, siblings)
}

pub fn authenticate(
  root: ByteArray,
  client: AuthToken,
  height: Height,
  record: ConsensusStateDatum,
  siblings: List<ByteArray>,
) -> Bool {
  consensus_history.authenticate(root, client, height, record, siblings)
}

pub fn with_witness_at_height(
  client: ClientDatum,
  root: ByteArray,
  witness: Option<Witness>,
  current_time: Int,
  proof_height: Option<Height>,
) -> ClientDatum {
  let hydrated =
    consensus_history.with_witness_at_height(
      ClientDatum { ..client, history_root: root },
      witness,
      current_time,
      proof_height,
    )
  ClientDatum { ..hydrated, history_root: client.history_root }
}

pub fn consensus_states_for_message(
  client: ClientDatum,
  root: ByteArray,
  witnesses: List<Witness>,
  current_time: Int,
  msg: ClientMessage,
) -> Pairs<Height, ConsensusState> {
  consensus_history.consensus_states_for_message(
    ClientDatum { ..client, history_root: root },
    witnesses,
    current_time,
    msg,
  )
}
