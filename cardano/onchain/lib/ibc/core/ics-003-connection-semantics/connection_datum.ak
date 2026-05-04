use aiken/collection/list
use ibc/auth.{AuthToken}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end_mod
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
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

  // NOTE: Avoid relying on derived equality for nested records that contain lists
  // (versions/features). We compare all fields explicitly to ensure OpenAck only
  // mutates the expected parts of the datum.
  let ConnectionDatum { state: input_state, token: input_token } = input_datum
  let ConnectionDatum { state: output_state, token: output_token } =
    output_datum

  let ConnectionEnd {
    client_id: input_client_id,
    versions: input_versions,
    counterparty: input_counterparty,
    delay_period: input_delay_period,
    ..
  } = input_state

  let ConnectionEnd {
    client_id: output_client_id,
    versions: output_versions,
    state: output_conn_state,
    counterparty: output_counterparty,
    delay_period: output_delay_period,
  } = output_state

  let Counterparty {
    client_id: input_cp_client_id,
    prefix: input_cp_prefix,
    ..
  } = input_counterparty

  let Counterparty {
    client_id: output_cp_client_id,
    connection_id: output_cp_conn_id,
    prefix: output_cp_prefix,
  } = output_counterparty

  and {
    output_token == input_token,
    output_client_id == input_client_id,
    output_conn_state == connection_state.Open,
    versions_equal(output_versions, input_versions),
    output_delay_period == input_delay_period,
    output_cp_client_id == input_cp_client_id,
    output_cp_conn_id == output_counterpary_conn_id,
    output_cp_prefix.key_prefix == input_cp_prefix.key_prefix,
  }
}

/// Validate whether the connection datum is updated valid for OpenConfirm step. 
/// All properties have been checked at OpenTry, so we only need to check state is updated correctly.
pub fn is_connection_open_confirm_valid(
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
) -> Bool {
  // input's ConnectionEnd is Init state
  expect input_datum.state.state == connection_state.TryOpen

  // NOTE: Avoid relying on derived equality for nested records that contain lists
  // (versions/features). We compare all fields explicitly to ensure OpenConfirm only
  // mutates the connection state.
  let ConnectionDatum { state: input_state, token: input_token } = input_datum
  let ConnectionDatum { state: output_state, token: output_token } =
    output_datum

  let ConnectionEnd {
    client_id: input_client_id,
    versions: input_versions,
    counterparty: input_counterparty,
    delay_period: input_delay_period,
    ..
  } = input_state

  let ConnectionEnd {
    client_id: output_client_id,
    versions: output_versions,
    state: output_conn_state,
    counterparty: output_counterparty,
    delay_period: output_delay_period,
  } = output_state

  and {
    output_token == input_token,
    output_client_id == input_client_id,
    output_conn_state == connection_state.Open,
    versions_equal(output_versions, input_versions),
    output_delay_period == input_delay_period,
    counterparty_equal(output_counterparty, input_counterparty),
  }
}

fn versions_equal(
  output_versions: List<Version>,
  input_versions: List<Version>,
) -> Bool {
  when output_versions is {
    [] -> list.is_empty(input_versions)
    [output_head, ..output_tail] ->
      when input_versions is {
        [] -> False
        [input_head, ..input_tail] -> and {
            version_equal(output_head, input_head),
            versions_equal(output_tail, input_tail),
          }
      }
  }
}

fn version_equal(output_version: Version, input_version: Version) -> Bool {
  and {
    output_version.identifier == input_version.identifier,
    features_equal(output_version.features, input_version.features),
  }
}

fn features_equal(
  output_features: List<ByteArray>,
  input_features: List<ByteArray>,
) -> Bool {
  when output_features is {
    [] -> list.is_empty(input_features)
    [output_head, ..output_tail] ->
      when input_features is {
        [] -> False
        [input_head, ..input_tail] -> and {
            output_head == input_head,
            features_equal(output_tail, input_tail),
          }
      }
  }
}

fn counterparty_equal(
  output_counterparty: Counterparty,
  input_counterparty: Counterparty,
) -> Bool {
  and {
    output_counterparty.client_id == input_counterparty.client_id,
    output_counterparty.connection_id == input_counterparty.connection_id,
    output_counterparty.prefix.key_prefix == input_counterparty.prefix.key_prefix,
  }
}
