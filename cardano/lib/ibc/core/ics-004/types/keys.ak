use aiken/bytearray
use aiken/int
use aiken/option
use aiken/string

pub const channel_prefix = "channel"

const channel_prefix_with_separator = "channel-"

const channel_prefix_with_separator_len = 8

pub fn format_channel_identifier(sequence: Int) -> ByteArray {
  expect sequence >= 0

  let sequence = string.from_int(sequence) |> string.to_bytearray()
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
  when parse_channel_id_sequence(channel_id) is {
    Some(_) -> True
    None -> False
  }
}
