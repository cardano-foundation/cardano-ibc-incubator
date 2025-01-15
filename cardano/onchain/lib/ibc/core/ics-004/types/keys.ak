use aiken/primitive/bytearray
use ibc/utils/string as string_utils

pub const channel_prefix = "channel"

const channel_prefix_with_separator = "channel-"

const channel_prefix_with_separator_len = 8

pub fn format_channel_identifier(sequence: ByteArray) -> ByteArray {
  bytearray.concat(channel_prefix_with_separator, sequence)
}

/// Parse sequence number of a channel_id.
/// The channel_id should be a valid Cardano IBC channel ID (validated with is_valid_channel_id()).
pub fn parse_channel_id_sequence(channel_id: ByteArray) -> ByteArray {
  bytearray.drop(channel_id, channel_prefix_with_separator_len)
}

pub fn is_valid_channel_id(channel_id: ByteArray) -> Bool {
  let prefix = bytearray.take(channel_id, channel_prefix_with_separator_len)
  if prefix == channel_prefix_with_separator {
    let str_id = bytearray.drop(channel_id, channel_prefix_with_separator_len)
    string_utils.is_uint_string(str_id)
  } else {
    False
  }
}
