use aiken/collection/list
use ibc/client/ics_007_tendermint_client/client_datum as tendermint_datum
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_history.{Witness}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/client_view.{ClientStateView, ClientView}
use ibc/core/ics_002_client_semantics/types/client.{Status, Unknown}

pub const client_type = "07-tendermint"

/// The caller authenticates the client's state token and registered script.
/// History authentication, expiration and Tendermint decoding stay here.
pub fn view(
  datum: Data,
  current_time: Int,
  proof_height: Option<Height>,
  history_witness: Option<Data>,
) -> ClientView {
  expect client: tendermint_datum.ClientDatum = datum

  let witness =
    when history_witness is {
      None -> None
      Some(raw) -> {
        expect decoded: Witness = raw

        Some(decoded)
      }
    }
  let hydrated =
    consensus_history.with_witness_at_height(
      client,
      witness,
      current_time,
      proof_height,
    )
  project(
    hydrated,
    client_state.status(
      hydrated.state.client_state,
      current_time,
      hydrated.state.consensus_states,
    ),
  )
}

/// Used only after the factory or client spend authenticates the transition.
pub fn commitment_view(datum: Data) -> ClientView {
  expect client: tendermint_datum.ClientDatum = datum
  project(client, Unknown)
}

fn project(client: tendermint_datum.ClientDatum, status: Status) -> ClientView {
  let result =
    ClientView {
      state: ClientStateView {
        client_state: client.state.client_state,
        consensus_states: list.map(
          client.state.consensus_states,
          fn(entry) {
            let Pair(h, state) = entry
            let payload: Data = state
            Pair(h, payload)
          },
        ),
        processed_times: client.state.processed_times,
        processed_heights: client.state.processed_heights,
      },
      token: client.token,
      latest_height: client.state.client_state.latest_height,
      status,
      timestamps: list.map(
        client.state.consensus_states,
        fn(entry) {
          let Pair(h, state) = entry
          Pair(h, state.timestamp)
        },
      ),
    }
  result
}
