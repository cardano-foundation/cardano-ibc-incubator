use aiken/dict.{Dict}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/header.{Header}

pub const client_token_prefix = "client"

pub type ClientDatum {
  state: ClientDatumState,
  token: AuthToken,
}

pub type ClientDatumState {
  client_state: ClientState,
  consensus_states: Dict<Height, ConsensusState>,
}

pub fn is_initialized_valid(datum: ClientDatum, auth_token: AuthToken) -> Bool {
  let ClientDatum { state, token } = datum
  let ClientDatumState { client_state, consensus_states } = state

  // validate client state
  expect client_state |> client_state.validate()

  // validate consensus states
  let latest_height = client_state |> client_state.get_latest_height()
  expect dict.size(consensus_states) == 1
  expect Some(_consensus_state) = consensus_states |> dict.get(latest_height)
  // TODO: add consensus_state.validate_basic()
  expect token == auth_token

  True
}

pub fn is_updated_valid(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  header: Header,
) -> Bool {
  let header_height = header |> header.get_height()

  expect !dict.has_key(input_datum.state.consensus_states, header_height)

  let latest_height = {
    let input_height =
      input_datum.state.client_state |> client_state.get_latest_height()
    if height.compare(header_height, input_height) == Greater {
      header_height
    } else {
      input_height
    }
  }

  let header_cons_state = header |> header.consensus_state()

  let expected_updated_cons_states =
    input_datum.state.consensus_states
      |> dict.insert(header_height, header_cons_state, height.compare)

  let expected_updated_client_state =
    ClientState {
      ..input_datum.state.client_state,
      latest_height: latest_height,
    }

  let expected_updated_output =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        client_state: expected_updated_client_state,
        consensus_states: expected_updated_cons_states,
      },
    }

  expected_updated_output == output_datum
}
