use aiken/bytearray
use aiken/dict.{Dict}
use aiken/list
use ibc/core/ics_004/types/packet.{Packet}

pub type MockModuleDatum {
  opened_channels: Dict<ByteArray, Bool>,
  received_packets: List<ByteArray>,
}

pub fn validate_on_chan_open_init(
  old_datum: MockModuleDatum,
  updated_datum: MockModuleDatum,
  channel_id: ByteArray,
) -> Bool {
  expect !dict.has_key(old_datum.opened_channels, channel_id)

  let expected_datum =
    MockModuleDatum {
      ..old_datum,
      opened_channels: dict.insert(
        old_datum.opened_channels,
        channel_id,
        True,
        bytearray.compare,
      ),
    }

  expect expected_datum == updated_datum

  True
}

pub fn validate_on_chan_open_try(
  old_datum: MockModuleDatum,
  updated_datum: MockModuleDatum,
  channel_id: ByteArray,
) -> Bool {
  expect !dict.has_key(old_datum.opened_channels, channel_id)

  let expected_datum =
    MockModuleDatum {
      ..old_datum,
      opened_channels: dict.insert(
        old_datum.opened_channels,
        channel_id,
        True,
        bytearray.compare,
      ),
    }

  expect expected_datum == updated_datum

  True
}

pub fn validate_on_chan_open_ack(
  old_datum: MockModuleDatum,
  updated_datum: MockModuleDatum,
  channel_id: ByteArray,
) -> Bool {
  expect Some(True) = dict.get(old_datum.opened_channels, channel_id)

  expect old_datum == updated_datum

  True
}

pub fn validate_on_chan_open_confirm(
  old_datum: MockModuleDatum,
  updated_datum: MockModuleDatum,
  channel_id: ByteArray,
) -> Bool {
  expect Some(True) = dict.get(old_datum.opened_channels, channel_id)

  expect old_datum == updated_datum

  True
}

pub fn validate_on_recv_packet(
  old_datum: MockModuleDatum,
  updated_datum: MockModuleDatum,
  channel_id: ByteArray,
  packet: Packet,
) -> Bool {
  expect Some(True) = dict.get(old_datum.opened_channels, channel_id)

  let expected_datum =
    MockModuleDatum {
      ..old_datum,
      received_packets: list.push(old_datum.received_packets, packet.data),
    }

  expect expected_datum == updated_datum

  True
}
