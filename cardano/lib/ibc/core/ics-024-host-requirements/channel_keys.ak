use aiken/bytearray
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}

pub const key_channel_end_prefix = "channelEnds"

pub const key_channel_prefix = "channels"

pub fn channel_path(port_id: ByteArray, channel_id: ByteArray) {
  key_channel_end_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_path_for_packet(port_id, channel_id))
}

pub fn channel_path_for_packet(port_id: ByteArray, channel_id: ByteArray) {
  key_port_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(port_id)
    |> bytearray.concat("/")
    |> bytearray.concat(key_channel_prefix)
    |> bytearray.concat("/")
    |> bytearray.concat(channel_id)
}

test test_channel_path() {
  channel_path("transfer", "channel-00") == "channelEnds/ports/transfer/channels/channel-00"
}
