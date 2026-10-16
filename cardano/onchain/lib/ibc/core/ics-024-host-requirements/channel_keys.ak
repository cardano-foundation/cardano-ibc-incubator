use aiken/primitive/bytearray
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}

pub const key_channel_end_prefix = "channelEnds"

pub const key_channel_prefix = "channels"

pub fn channel_path(port_id: ByteArray, channel_id: ByteArray) {
  key_channel_end_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(channel_path_for_packet(port_id, channel_id))
}

const channel_upgrade_prefix = "channelUpgrades/upgrades/"

const channel_upgrade_error_prefix = "channelUpgrades/upgradeError/"

pub fn channel_upgrade_path(port_id: ByteArray, channel_id: ByteArray) {
  channel_upgrade_prefix
    |> bytearray.concat(channel_path_for_packet(port_id, channel_id))
}

pub fn channel_upgrade_error_path(port_id: ByteArray, channel_id: ByteArray) {
  channel_upgrade_error_prefix
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

// ibc-go host.ChannelUpgradePath and host.ChannelUpgradeErrorPath.
test test_channel_upgrade_paths() {
  and {
    channel_upgrade_path("transfer", "channel-7") == "channelUpgrades/upgrades/ports/transfer/channels/channel-7",
    channel_upgrade_error_path("transfer", "channel-7") == "channelUpgrades/upgradeError/ports/transfer/channels/channel-7",
  }
}
