use aiken/bytearray
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_024_host_requirements/validate

/// Packet defines a type that carries data across different chains through IBC
pub type Packet {
  /// number corresponds to the order of sends and receives, where a Packet
  /// with an earlier sequence number must be sent and received before a Packet
  /// with a later sequence number.
  sequence: Int,
  /// identifies the port on the sending chain.
  source_port: ByteArray,
  /// identifies the channel end on the sending chain.
  source_channel: ByteArray,
  /// identifies the port on the receiving chain.
  destination_port: ByteArray,
  /// identifies the channel end on the receiving chain.
  destination_channel: ByteArray,
  /// actual opaque bytes transferred directly to the application module
  data: ByteArray,
  /// block height after which the packet times out
  timeout_height: Height,
  /// block timestamp (in nanoseconds) after which the packet times out
  timeout_timestamp: Int,
}

/// new_packet creates a new Packet instance. It panics if the provided
pub fn new_packet(
  sequence: Int,
  source_port: ByteArray,
  source_channel: ByteArray,
  destination_port: ByteArray,
  destination_channel: ByteArray,
  data: ByteArray,
  timeout_height: Height,
  timeout_timestamp: Int,
) -> Packet {
  Packet {
    sequence,
    source_port,
    source_channel,
    destination_port,
    destination_channel,
    data,
    timeout_height,
    timeout_timestamp,
  }
}

/// validate_basic validate minimum requirements of a valid packet
pub fn validate_basic(p: Packet) -> Bool {
  expect validate.port_identifier_validator(p.source_port)

  expect validate.port_identifier_validator(p.destination_port)

  expect validate.channel_identifier_validator(p.source_channel)

  expect validate.channel_identifier_validator(p.destination_channel)

  expect p.sequence > 0

  expect height.is_valid(p.timeout_height)

  expect p.timeout_timestamp >= 0

  expect !height.is_zero(p.timeout_height) || p.timeout_timestamp != 0

  expect bytearray.length(p.data) > 0

  True
}

pub fn commit_packet(_packet: Packet) -> ByteArray {
  // TODO: add more logic
  ""
}
