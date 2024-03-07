use aiken/list
use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version

pub type ConnectionDatum {
  state: ConnectionEnd,
  token: AuthToken,
}

pub fn is_conn_open_init_valid(
  datum: ConnectionDatum,
  auth_token: AuthToken,
) -> Bool {
  let ConnectionDatum { state, token } = datum

  expect connection_end.validate_basic(state)?

  let ConnectionEnd { versions, state, counterparty, .. } = state

  let compatible_versions = version.get_compatible_versions()

  expect token == auth_token

  expect
    list.all(
      versions,
      fn(ver) { version.is_supported_version(compatible_versions, ver) },
    )

  expect state == connection_state.Init

  expect counterparty.connection_id == ""

  True
}

pub fn is_conn_open_try_valid(
  datum: ConnectionDatum,
  auth_token: AuthToken,
) -> Bool {
  let ConnectionDatum { state, token } = datum

  expect connection_end.validate_basic(state)?

  let ConnectionEnd { versions, state, counterparty, .. } = state

  let compatible_versions = version.get_compatible_versions()

  expect token == auth_token

  expect
    list.all(
      versions,
      fn(ver) { version.is_supported_version(compatible_versions, ver) },
    )

  expect state == connection_state.TryOpen

  expect counterparty.connection_id != ""

  True
}

pub fn is_connection_open_ack_valid(
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
) -> Bool {
  // input's ConnectionEnd is Init state
  expect input_datum.state.state == connection_state.Init

  // output's ConnectionEnd is updated correctly
  let output_counterpary_conn_id = output_datum.state.counterparty.connection_id
  expect output_counterpary_conn_id != ""

  expect connection_end.validate_basic(output_datum.state)

  let expected_datum =
    ConnectionDatum {
      ..input_datum,
      state: ConnectionEnd {
        ..input_datum.state,
        state: connection_state.Open,
        counterparty: Counterparty {
          ..input_datum.state.counterparty,
          connection_id: output_counterpary_conn_id,
        },
      },
    }

  expected_datum == output_datum
}

pub fn is_connection_open_confirm_valid(
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
) -> Bool {
  // input's ConnectionEnd is Init state
  expect input_datum.state.state == connection_state.TryOpen

  let expected_datum =
    ConnectionDatum {
      ..input_datum,
      state: ConnectionEnd { ..input_datum.state, state: connection_state.Open },
    }

  expected_datum == output_datum
}
