use aiken/dict.{Dict}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}

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
  expect client_state_mod.validate(client_state)

  // validate consensus states
  let latest_height = client_state_mod.get_latest_height(client_state)
  expect dict.size(consensus_states) == 1
  expect Some(_consensus_state) = dict.get(consensus_states, latest_height)
  // TODO: add consensus_state.validate_basic()
  expect token == auth_token

  True
}

pub fn update_state(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  header: Header,
  tx_valid_from: Int,
) -> Bool {
  let header_height = header_mod.get_height(header)

  expect !dict.has_key(input_datum.state.consensus_states, header_height)

  let latest_height = {
    let input_height =
      input_datum.state.client_state |> client_state_mod.get_latest_height()
    if height.compare(header_height, input_height) == Greater {
      header_height
    } else {
      input_height
    }
  }
  let expected_client_state =
    ClientState {
      ..input_datum.state.client_state,
      latest_height: latest_height,
    }

  let expected_cons_state =
    dict.filter(
      input_datum.state.consensus_states,
      fn(_key, val) {
        !client_state_mod.is_expired(
          input_datum.state.client_state,
          val.timestamp,
          tx_valid_from * 1_000_000,
        )
      },
    )

  let expected_cons_state =
    dict.insert(
      expected_cons_state,
      header_height,
      header_mod.consensus_state(header),
      height.compare,
    )

  let expected_updated_output =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        client_state: expected_client_state,
        consensus_states: expected_cons_state,
      },
    }

  expected_updated_output == output_datum
}

pub fn update_state_on_misbehaviour(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
) -> Bool {
  // frozen_height is same for all misbehaviour
  let frozen_height = Height { revision_number: 0, revision_height: 1 }

  let expected_datum =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        ..input_datum.state,
        client_state: ClientState {
          ..input_datum.state.client_state,
          frozen_height: frozen_height,
        },
      },
    }

  expected_datum == output_datum
}
