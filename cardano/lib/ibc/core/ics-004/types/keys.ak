use aiken/bytearray
use aiken/int
use aiken/option
use aiken/string

pub const channel_prefix = "channel"

pub fn format_channel_identifier(sequence: Int) -> ByteArray {
  expect sequence >= 0

  let sequence = string.from_int(sequence) |> string.to_bytearray()
  bytearray.concat(channel_prefix, "-") |> bytearray.concat(sequence)
}

/// Parse sequence number of a channel_id.
/// The channel_id should be validated basic before.
pub fn parse_channel_id_sequence(channel_id: ByteArray) -> Option<Int> {
  bytearray.index_of(channel_id, "-")
    |> option.map(fn(indexes) { indexes.1st })
    |> option.and_then(
         fn(separate_idx) {
           let prefix = bytearray.take(channel_id, separate_idx)

           if prefix == channel_prefix {
             Some(separate_idx)
           } else {
             None
           }
         },
       )
    |> option.and_then(
         fn(separate_idx) {
           let str_id = bytearray.drop(channel_id, separate_idx + 1)
           int.from_utf8(str_id)
         },
       )
    |> option.and_then(
         fn(id) {
           if id >= 0 {
             Some(id)
           } else {
             None
           }
         },
       )
}

pub fn is_valid_channel_id(channel_id: ByteArray) -> Bool {
  when parse_channel_id_sequence(channel_id) is {
    Some(_) -> True
    None -> False
  }
}
