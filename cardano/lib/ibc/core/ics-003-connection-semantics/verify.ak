use ibc/client/cardano_client/client_state as cardano_client
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_004/types/channel.{Channel}

pub fn verify_connection_state(
  _client_datum_state: ClientDatumState,
  _connection: ConnectionEnd,
  _counterpary_connection: ConnectionEnd,
  _proof: ByteArray,
  _proof_height: Height,
) -> Bool {
  True
}

pub fn verify_client_state(
  _client_datum_state: ClientDatumState,
  _connection: ConnectionEnd,
  _counterpatry_client_state: cardano_client.ClientState,
  _proof: ByteArray,
  _proof_height: Height,
) -> Bool {
  True
}

pub fn verify_channel_state(
  _client_datum_state: ClientDatumState,
  _connection: ConnectionEnd,
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _proof: ByteArray,
  _proof_height: Height,
  _channel: Channel,
) -> Bool {
  True
}

pub fn verify_packet_commitment(
  _client_datum_state: ClientDatumState,
  _connection: ConnectionEnd,
  _proof_height: Height,
  _proof: ByteArray,
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _sequence: Int,
  _commitment_bytes: ByteArray,
) -> Bool {
  True
}
