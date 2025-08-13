use aiken/collection/list
use aiken/collection/pairs
use aiken/math
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_consensus_state_size,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}

pub type ClientDatum {
  state: ClientDatumState,
  token: AuthToken,
}

pub type ClientDatumState {
  client_state: ClientState,
  consensus_states: Pairs<Height, ConsensusState>,
}

pub fn is_initialized_valid(datum: ClientDatum, auth_token: AuthToken) -> Bool {
  let ClientDatum { state, token } = datum
  let ClientDatumState { client_state, consensus_states } = state

  // validate client state
  expect client_state_mod.validate(client_state)

  // validate consensus states
  let latest_height = client_state_mod.get_latest_height(client_state)

  when consensus_states is {
    [height_consensus_state] -> and {
        // TODO: add consensus_state.validate_basic()
        height_consensus_state.1st == latest_height,
        token == auth_token,
      }
    _ -> False
  }
}

pub fn update_state(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  header: Header,
  tx_valid_from: Int,
) -> Bool {
  let header_height = header_mod.get_height(header)

  let input_datum_cons_state = input_datum.state.consensus_states

  expect (!pairs.has_key(input_datum_cons_state, header_height))?

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
    list.filter(
      input_datum_cons_state,
      fn(item) {
        !client_state_mod.is_expired(
          input_datum.state.client_state,
          item.2nd.timestamp,
          tx_valid_from * 1_000_000,
        )
      },
    )

  let cs_len = list.length(expected_cons_state)

  let expected_cons_state =
    [
      Pair(header_height, header_mod.consensus_state(header)),
      ..expected_cons_state
    ]
      |> list.slice(from: 0, to: math.min(max_consensus_state_size - 1, cs_len))

  let expected_updated_output =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        client_state: expected_client_state,
        consensus_states: expected_cons_state,
      },
    }

  let output_cons_states = output_datum.state.consensus_states
  let expected_cons_states = expected_updated_output.state.consensus_states

  let block_heights = pairs.keys(output_cons_states)
  expect list.difference(block_heights, pairs.keys(expected_cons_states)) == []
  expect list.difference(pairs.keys(expected_cons_states), block_heights) == []
  and {
    (expected_updated_output.state.client_state == output_datum.state.client_state)?,
    (expected_updated_output.token == output_datum.token)?,
    list.all(
      block_heights,
      fn(block_height) {
        pairs.get_all(output_cons_states, block_height) == pairs.get_all(
          expected_cons_states,
          block_height,
        )
      },
    ),
  }
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
