use aiken/collection/list
use aiken/primitive/bytearray
use ibc/utils/string

pub const default_max_character_length = 64

pub const default_max_port_character_length = 128

pub fn client_identifier_validator(id: ByteArray) -> Bool {
  default_identifier_validator(id, 9, default_max_character_length)
}

pub fn connection_identifier_validator(id: ByteArray) -> Bool {
  default_identifier_validator(id, 10, default_max_character_length)
}

pub fn port_identifier_validator(id: ByteArray) -> Bool {
  default_identifier_validator(id, 2, default_max_port_character_length)
}

pub fn channel_identifier_validator(id: ByteArray) -> Bool {
  default_identifier_validator(id, 8, default_max_character_length)
}

fn default_identifier_validator(id: ByteArray, min: Int, max: Int) -> Bool {
  and {
    string.trim_space(id) != "",
    min <= bytearray.length(id) && bytearray.length(id) <= max,
    is_valid_id(id),
  }
}

fn is_valid_id(id: ByteArray) -> Bool {
  id
    |> bytearray.reduce(
        True,
        fn(result, cur_byte) {
          let is_valid_char = or {
              // 'a' <= char <= 'z'
              0x61 <= cur_byte && cur_byte <= 0x7a,
              // 'A' <= char <= 'Z'
              0x41 <= cur_byte && cur_byte <= 0x5a,
              // '0' <= char <= '9'
              0x30 <= cur_byte && cur_byte <= 0x39,
              // chars '.', '_', '+', '-', '#', '[', ']', '<', '>'
              [0x2e, 0x5f, 0x2b, 0x2d, 0x23, 0x5b, 0x5d, 0x3c, 0x3e]
                |> list.has(cur_byte),
            }

          result && is_valid_char
        },
      )
}
