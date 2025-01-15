use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/validate

/// Counterparty defines the counterparty chain associated with a connection end.
pub type Counterparty {
  // identifies the client on the counterparty chain associated with a given connection.
  client_id: ByteArray,
  // identifies the connection end on the counterparty chain associated with a given connection.
  connection_id: ByteArray,
  // commitment merkle prefix of the counterparty chain.
  prefix: MerklePrefix,
}

/// new_counterparty creates a new Counterparty instance.
pub fn new_counterparty(
  client_id: ByteArray,
  connection_id: ByteArray,
  prefix: MerklePrefix,
) -> Counterparty {
  Counterparty { client_id, connection_id, prefix }
}

/// GetClientID implements the CounterpartyConnectionI interface
pub fn get_client_id(c: Counterparty) -> ByteArray {
  c.client_id
}

/// get_connection_id implements the CounterpartyConnectionI interface
pub fn get_connection_id(c: Counterparty) -> ByteArray {
  c.connection_id
}

/// get_prefix implements the CounterpartyConnectionI interface
pub fn get_prefix(c: Counterparty) -> MerklePrefix {
  c.prefix
}

/// validate_basic performs a basic validation check of the identifiers and prefix
pub fn validate_basic(c: Counterparty) -> Bool {
  and {
    c.connection_id == "" || validate.connection_identifier_validator(
      c.connection_id,
    ),
    validate.client_identifier_validator(c.client_id),
    !merkle_prefix.empty(c.prefix),
  }
}
