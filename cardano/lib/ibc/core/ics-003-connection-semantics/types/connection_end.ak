use aiken/list
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{State}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_024_host_requirements/validate

pub type ConnectionEnd {
  client_id: ByteArray,
  versions: List<Version>,
  state: State,
  counterparty: Counterparty,
  delay_period: Int,
}

/// new_connection_end creates a new ConnectionEnd instance.
pub fn new_connection_end(
  state: State,
  client_id: ByteArray,
  counterparty: Counterparty,
  versions: List<Version>,
  delay_period: Int,
) -> ConnectionEnd {
  ConnectionEnd { client_id, versions, state, counterparty, delay_period }
}

/// get_client_id implements the Connection interface
pub fn get_client_id(c: ConnectionEnd) -> ByteArray {
  c.client_id
}

/// get_versions implements the Connection interface
pub fn get_versions(c: ConnectionEnd) -> List<Version> {
  c.versions
}

/// get_state implements the Connection interface
pub fn get_state(c: ConnectionEnd) -> State {
  c.state
}

/// get_counterparty implements the Connection interface
pub fn get_counterparty(c: ConnectionEnd) -> Counterparty {
  c.counterparty
}

/// get_delay_period implements the Connection interface
pub fn get_delay_period(c: ConnectionEnd) -> Int {
  c.delay_period
}

/// validate_basic implements the Connection interface.
pub fn validate_basic(c: ConnectionEnd) -> Bool {
  and {
    validate.client_identifier_validator(c.client_id),
    list.length(c.versions) > 0,
    list.all(c.versions, fn(ver) { version.validate_version(ver) }),
    counterparty.validate_basic(c.counterparty),
  }
}
