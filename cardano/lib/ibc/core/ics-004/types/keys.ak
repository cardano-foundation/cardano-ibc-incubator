use aiken/bytearray
use aiken/int
use aiken/option
use ibc/utils/string as string_utils

pub const channel_prefix = "channel"

const channel_prefix_with_separator = "channel-"

const channel_prefix_with_separator_len = 8

pub fn format_channel_identifier(sequence: ByteArray) -> ByteArray {
  bytearray.concat(channel_prefix_with_separator, sequence)
}

/// Parse sequence number of a channel_id.
/// The channel_id should be validated basic before.
pub fn parse_channel_id_sequence(channel_id: ByteArray) -> Option<Int> {
  if
  bytearray.take(channel_id, channel_prefix_with_separator_len) == channel_prefix_with_separator{
  
    let str_id = bytearray.drop(channel_id, channel_prefix_with_separator_len)
    int.from_utf8(str_id)
      |> option.and_then(
          fn(id) {
            if id >= 0 {
              Some(id)
            } else {
              None
            }
          },
        )
  } else {
    None
  }
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
