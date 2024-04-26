use aiken/list
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb.{
  ConnectionEnd as ConnectionEndProto, INIT, OPEN, State as StateProto, TRYOPEN,
  UNINITIALIZED,
}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{
  Init, Open, State, TryOpen, Uninitialized,
}
use ibc/core/ics_003_connection_semantics/types/version.{Version}

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

pub fn convert_to_connection_end_proto(
  connection_end: ConnectionEnd,
) -> ConnectionEndProto {
  ConnectionEndProto {
    client_id: connection_end.client_id,
    versions: list.indexed_map(
      connection_end.versions,
      fn(i, _v) { list.at(connection_end.versions, i) },
    ),
    state: convert_to_state_proto(connection_end.state),
    counterparty: connection_end.counterparty,
    delay_period: connection_end.delay_period,
  }
}

pub fn convert_to_state_proto(state: State) -> StateProto {
  when state is {
    Uninitialized -> UNINITIALIZED
    Init -> INIT
    TryOpen -> TRYOPEN
    Open -> OPEN
  }
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

/// Validate basic for ConnectionEnd's props.
/// client_id must be a valid Cardano IBC client ID.
/// counterparty' IDs only need to be validated basic.
pub fn validate_basic(c: ConnectionEnd) -> Bool {
  and {
    client_keys_mod.is_valid_client_id(c.client_id),
    list.length(c.versions) > 0,
    list.all(c.versions, fn(ver) { version.validate_version(ver) }),
    counterparty.validate_basic(c.counterparty),
  }
}
