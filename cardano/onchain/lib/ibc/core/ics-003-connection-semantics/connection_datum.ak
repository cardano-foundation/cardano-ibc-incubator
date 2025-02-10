use aiken/collection/list
use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end_mod
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version as version_mod
use ibc/core/ics_024_host_requirements/validate as host_validate_mod

pub type ConnectionDatum {
  state: ConnectionEnd,
  token: AuthToken,
}

/// Validate whether the connection datum is initialized valid for OpenInt step. 
/// connection end should be validated basic and counterparty's connection_id must be null.
pub fn is_conn_open_init_valid(
  datum: ConnectionDatum,
  auth_token: AuthToken,
) -> Bool {
  let ConnectionDatum { state, token } = datum

  let valid_connection_end = connection_end_mod.validate_basic(state)

  let ConnectionEnd { versions, state, counterparty, .. } = state

  let compatible_versions = version_mod.get_compatible_versions()

  and {
    valid_connection_end,
    token == auth_token,
    list.all(
      versions,
      fn(ver) { version_mod.is_supported_version(compatible_versions, ver) },
    ),
    state == connection_state.Init,
    counterparty.connection_id == "",
  }
}

/// Validate whether the connection datum is initialized valid for OpenTry step. 
/// connection end should be validated basic and counterparty's connection_id must be specified.
pub fn is_conn_open_try_valid(
  datum: ConnectionDatum,
  auth_token: AuthToken,
) -> Bool {
  let ConnectionDatum { state, token } = datum
  let valid_connection_end = connection_end_mod.validate_basic(state)
  let ConnectionEnd { versions, state, counterparty, .. } = state

  let compatible_versions = version_mod.get_compatible_versions()
  and {
    valid_connection_end,
    token == auth_token,
    list.all(
      versions,
      fn(ver) { version_mod.is_supported_version(compatible_versions, ver) },
    ),
    state == connection_state.TryOpen,
    counterparty.connection_id != "",
  }
}

/// Validate whether the connection datum is updated valid for OpenAck step. 
/// All other properties have been checked at OpenInit, so we only
/// need to check whether newly added counterparty.connection_id is valid.
pub fn is_connection_open_ack_valid(
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
) -> Bool {
  // input's ConnectionEnd is Init state
  expect input_datum.state.state == connection_state.Init

  // output's ConnectionEnd is updated correctly
  let output_counterpary_conn_id = output_datum.state.counterparty.connection_id

  expect
    host_validate_mod.connection_identifier_validator(
      output_counterpary_conn_id,
    )

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

/// Validate whether the connection datum is updated valid for OpenConfirm step. 
/// All properties have been checked at OpenTry, so we only need to check state is updated correctly.
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
