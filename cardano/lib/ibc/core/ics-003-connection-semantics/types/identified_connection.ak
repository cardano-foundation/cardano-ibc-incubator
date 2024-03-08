use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{State}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_024_host_requirements/validate

/// IdentifiedConnection defines a connection with additional connection identifier field.
pub type IdentifiedConnection {
  // connection identifier.
  id: ByteArray,
  // client associated with this connection.
  client_id: ByteArray,
  // IBC version which can be utilised to determine encodings or protocols for
  // channels or packets utilising this connection
  versions: List<Version>,
  // current state of the connection end.
  state: State,
  // counterparty chain associated with this connection.
  counterparty: Counterparty,
  // delay period associated with this connection.
  delay_period: Int,
}

pub fn new_identified_connection(
  connection_id: ByteArray,
  conn: ConnectionEnd,
) -> IdentifiedConnection {
  IdentifiedConnection {
    id: connection_id,
    client_id: conn.client_id,
    versions: conn.versions,
    state: conn.state,
    counterparty: conn.counterparty,
    delay_period: conn.delay_period,
  }
}

pub fn validate_basic(ic: IdentifiedConnection) -> Bool {
  and {
    validate.connection_identifier_validator(ic.id),
    {
      let connection =
        connection_end.new_connection_end(
          ic.state,
          ic.client_id,
          ic.counterparty,
          ic.versions,
          ic.delay_period,
        )
      connection_end.validate_basic(connection)
    },
  }
}
