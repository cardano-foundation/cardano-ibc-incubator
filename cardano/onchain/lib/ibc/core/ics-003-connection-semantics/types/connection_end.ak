use aiken/builtin.{if_then_else as ite}
use aiken/collection/list
use aiken/primitive/bytearray.{concat, push}
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
use ibc/utils/bytes.{encode_bytearray, encode_length_varint, encode_varint}

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

/// Canonical IBC protobuf bytes without constructing a protobuf ConnectionEnd.
/// Keep the domain state boundary and the generated nested-message encoders.
pub fn marshal(connection_end: ConnectionEnd) -> ByteArray {
  let ConnectionEnd { client_id, versions, state, counterparty, delay_period } =
    connection_end
  #[]
    |> concat(
        {
          let (_, bz) =
            encode_bytearray(client_id, bytes.field_1_length_delimited)
          bz
        },
      )
    |> concat(
        list.reduce(
          versions,
          #[],
          fn(bz1: ByteArray, version: Version) -> ByteArray {
            let (size, bz2) = connection_pb.marshal_for_version(version)
            bz1
              |> concat(
                  size
                    |> encode_length_varint()
                    |> concat(bz2)
                    |> push(bytes.field_2_length_delimited),
                )
          },
        ),
      )
    |> concat(
        {
          let int_state =
            when state is {
              Uninitialized -> 0
              Init -> 1
              TryOpen -> 2
              Open -> 3
            }
          ite(
            int_state == 0,
            #[],
            int_state
              |> encode_varint()
              |> push(bytes.field_3_varint),
          )
        },
      )
    |> concat(
        {
          let (size, bz) = connection_pb.marshal_for_counterparty(counterparty)
          size
            |> encode_length_varint()
            |> concat(bz)
            |> push(bytes.field_4_length_delimited)
        },
      )
    |> concat(
        ite(
          delay_period == 0,
          #[],
          delay_period
            |> encode_varint()
            |> push(bytes.field_5_varint),
        ),
      )
}

pub fn convert_to_connection_end_proto(
  connection_end: ConnectionEnd,
) -> ConnectionEndProto {
  ConnectionEndProto {
    client_id: connection_end.client_id,
    versions: connection_end.versions,
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
    !list.is_empty(c.versions),
    list.all(c.versions, fn(ver) { version.validate_version(ver) }),
    counterparty.validate_basic(c.counterparty),
  }
}
