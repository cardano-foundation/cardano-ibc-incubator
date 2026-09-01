use aiken/builtin
use aiken/primitive/bytearray.{at, concat, length, push}
use aiken/primitive/int
use ibc/apps/transfer/types/ibc_trace
use ibc/utils/string

/// The maximum encoded ICS-20 packet accepted by the on-chain validators.
pub const max_packet_bytes = 512

pub const max_denom_bytes = 256

pub const max_amount_bytes = 78

pub const max_sender_bytes = 256

pub const max_receiver_bytes = 256

pub const max_memo_bytes = 512

pub type FungibleTokenPacketData {
  /// the token denomination to be transferred
  denom: ByteArray,
  /// the token amount to be transferred
  amount: ByteArray,
  /// the sender address
  sender: ByteArray,
  /// the recipient address on the destination chain
  receiver: ByteArray,
  /// optional memo
  memo: ByteArray,
}

/// Raw field bounds are checked before encoding so packet validation has a
/// predictable upper cost even when characters expand while being escaped.
pub fn fields_within_limits(ftpd: FungibleTokenPacketData) -> Bool {
  and {
    length(ftpd.denom) <= max_denom_bytes,
    length(ftpd.amount) <= max_amount_bytes,
    length(ftpd.sender) <= max_sender_bytes,
    length(ftpd.receiver) <= max_receiver_bytes,
    length(ftpd.memo) <= max_memo_bytes,
  }
}

pub fn validate_basic(ftpd: FungibleTokenPacketData) -> Bool {
  packet_fields_valid(ftpd) && when int.from_utf8(ftpd.amount) is {
    Some(amount) -> and {
        amount > 0,
        string.trim_space(ftpd.sender) != "",
        string.trim_space(ftpd.receiver) != "",
        ibc_trace.validate_prefixed_denom(ftpd.denom),
      }
    None -> False
  }
}

/// Encode the packet exactly as the current Cardano TypeScript transaction
/// builder does: alphabetically sorted keys and JavaScript JSON escaping.
pub fn get_bytes(ftpd: FungibleTokenPacketData) -> ByteArray {
  expect packet_fields_valid(ftpd)
  expect fields_are_utf8(ftpd)
  sorted_bytes(ftpd, False)
}

/// Encode the packet exactly as the pinned ibc-go v8 implementation does:
/// alphabetically sorted keys and Go JSON escaping.
pub fn get_v8_bytes(ftpd: FungibleTokenPacketData) -> ByteArray {
  expect packet_fields_valid(ftpd)
  expect fields_are_utf8(ftpd)
  sorted_bytes(ftpd, True)
}

/// Encode the packet exactly as the pinned ibc-go v10 implementation does:
/// Go struct-field order and Go JSON escaping.
pub fn get_v10_bytes(ftpd: FungibleTokenPacketData) -> ByteArray {
  expect packet_fields_valid(ftpd)
  expect fields_are_utf8(ftpd)
  struct_order_bytes(ftpd)
}

/// Strictly check the fields, then match one of the three canonical encodings.
/// Validators that already called `validate_basic` may use `matches_valid_bytes`.
pub fn matches_bytes(
  ftpd: FungibleTokenPacketData,
  packet_data: ByteArray,
) -> Bool {
  packet_fields_valid(ftpd) && matches_valid_bytes(ftpd, packet_data)
}

/// Match bytes after `validate_basic` has established the field bounds.
pub fn matches_valid_bytes(
  ftpd: FungibleTokenPacketData,
  packet_data: ByteArray,
) -> Bool {
  if length(packet_data) <= max_packet_bytes {
    expect _ = builtin.decode_utf8(packet_data)
    // Required fields make the first key an unambiguous profile discriminator.
    if builtin.slice_bytearray(2, 1, packet_data) == "d" {
      struct_order_bytes(ftpd) == packet_data
    } else {
      or {
        sorted_bytes(ftpd, False) == packet_data,
        sorted_bytes(ftpd, True) == packet_data,
      }
    }
  } else {
    False
  }
}

fn fields_are_utf8(ftpd: FungibleTokenPacketData) -> Bool {
  let fields =
    ftpd.denom
      |> concat(#"00")
      |> concat(ftpd.amount)
      |> concat(#"00")
      |> concat(ftpd.sender)
      |> concat(#"00")
      |> concat(ftpd.receiver)
      |> concat(#"00")
      |> concat(ftpd.memo)

  builtin.decode_utf8(fields) != @""
}

fn packet_fields_valid(ftpd: FungibleTokenPacketData) -> Bool {
  let denom_length = length(ftpd.denom)
  let amount_length = length(ftpd.amount)
  let sender_length = length(ftpd.sender)
  let receiver_length = length(ftpd.receiver)
  let memo_length = length(ftpd.memo)

  // The aggregate cap makes it impossible for two of the 256-byte fields to
  // exceed their limits together. These products compactly enforce non-empty
  // required fields and each individual maximum alongside that aggregate cap.
  and {
    denom_length * sender_length * receiver_length * (
      max_denom_bytes + 1 - denom_length
    ) * ( max_sender_bytes + 1 - sender_length ) * (
      max_receiver_bytes + 1 - receiver_length
    ) > 0,
    amount_length * ( max_amount_bytes + 1 - amount_length ) > 0,
    denom_length + amount_length + sender_length + receiver_length + memo_length + if memo_length == 0 {
      50
    } else {
      60
    } <= max_packet_bytes,
  }
}

fn sorted_bytes(ftpd: FungibleTokenPacketData, go_html_safe: Bool) -> ByteArray {
  let FungibleTokenPacketData { amount, denom, memo, receiver, sender } = ftpd

  #""
    |> append_bounded("{\"amount\":\"", amount, go_html_safe)
    |> append_bounded("\",\"denom\":\"", denom, go_html_safe)
    |> append_optional_memo(memo, go_html_safe)
    |> append_bounded("\",\"receiver\":\"", receiver, go_html_safe)
    |> append_bounded("\",\"sender\":\"", sender, go_html_safe)
    |> concat("\"}")
}

fn struct_order_bytes(ftpd: FungibleTokenPacketData) -> ByteArray {
  let FungibleTokenPacketData { amount, denom, memo, receiver, sender } = ftpd

  #""
    |> append_bounded("{\"denom\":\"", denom, True)
    |> append_bounded("\",\"amount\":\"", amount, True)
    |> append_bounded("\",\"sender\":\"", sender, True)
    |> append_bounded("\",\"receiver\":\"", receiver, True)
    |> append_optional_memo(memo, True)
    |> concat("\"}")
}

fn append_bounded(
  packet_data: ByteArray,
  prefix: ByteArray,
  value: ByteArray,
  go_html_safe: Bool,
) -> ByteArray {
  packet_data
    |> concat(prefix)
    |> concat(escape_json_string(value, go_html_safe))
    |> require_packet_limit
}

fn append_optional_memo(
  packet_data: ByteArray,
  memo: ByteArray,
  go_html_safe: Bool,
) -> ByteArray {
  if memo == "" {
    packet_data
  } else {
    append_bounded(packet_data, "\",\"memo\":\"", memo, go_html_safe)
  }
}

fn escape_json_string(value: ByteArray, go_html_safe: Bool) -> ByteArray {
  let value_length = length(value)
  if go_html_safe || !needs_no_basic_escape(value) {
    escape_json_bytes(value, value_length - 1, value_length, #"", go_html_safe)
  } else {
    value
  }
}

fn needs_no_basic_escape(value: ByteArray) -> Bool {
  let value_length = length(value)

  has_no_zero_byte(
    builtin.and_bytearray(
      False,
      value,
      builtin.replicate_byte(value_length, 96),
    )
      |> concat(
          builtin.xor_bytearray(
            False,
            value |> concat(value),
            builtin.replicate_byte(value_length, 34)
              |> concat(builtin.replicate_byte(value_length, 92)),
          ),
        ),
  )
}

fn has_no_zero_byte(value: ByteArray) -> Bool {
  let value_length = length(value) + 1
  let value = value |> push(2)
  let decremented =
    builtin.integer_to_bytearray(
      True,
      value_length,
      builtin.bytearray_to_integer(True, value) - builtin.bytearray_to_integer(
        True,
        builtin.replicate_byte(value_length, 1),
      ),
    )

  builtin.count_set_bits(
    builtin.and_bytearray(
      False,
      builtin.and_bytearray(
        False,
        decremented,
        builtin.complement_bytearray(value),
      ),
      builtin.replicate_byte(value_length, 128),
    ),
  ) == 0
}

/// Scan without rebuilding ordinary runs byte-by-byte. A complete safe run is
/// sliced once, while only JSON metacharacters introduce a new output chunk.
fn escape_json_bytes(
  value: ByteArray,
  cursor: Int,
  run_end: Int,
  escaped: ByteArray,
  go_html_safe: Bool,
) -> ByteArray {
  if cursor < 0 {
    builtin.slice_bytearray(0, run_end, value) |> concat(escaped)
  } else {
    let byte = at(value, cursor)
    let basic_escape = byte < 32 || byte == 34 || byte == 92
    let is_line_separator =
      go_html_safe && cursor >= 2 && byte >= 168 && byte <= 169 && builtin.slice_bytearray(
        cursor - 2,
        2,
        value,
      ) == #"e280"
    let go_escape = go_html_safe && or {
        byte == 38,
        byte == 60,
        byte == 62,
      }

    if !(basic_escape || go_escape || is_line_separator) {
      escape_json_bytes(value, cursor - 1, run_end, escaped, go_html_safe)
    } else {
      let consumed =
        if is_line_separator {
          3
        } else {
          1
        }
      let replacement =
        if is_line_separator {
          #"5c75323032" |> concat(#[] |> push(byte - 112))
        } else if go_escape {
          unicode_control_escape(byte)
        } else {
          basic_json_escape(byte)
        }
      let escaped =
        replacement
          |> concat(
              builtin.slice_bytearray(cursor + 1, run_end - cursor - 1, value),
            )
          |> concat(escaped)
      expect length(escaped) <= max_packet_bytes

      escape_json_bytes(
        value,
        cursor - consumed,
        cursor - consumed + 1,
        escaped,
        go_html_safe,
      )
    }
  }
}

fn basic_json_escape(byte: Int) -> ByteArray {
  if byte == 34 || byte == 92 {
    #[] |> push(byte) |> push(92)
  } else if byte >= 8 && byte <= 13 && byte != 11 {
    #[] |> push(at("btn?fr", byte - 8)) |> push(92)
  } else {
    unicode_control_escape(byte)
  }
}

fn unicode_control_escape(byte: Int) -> ByteArray {
  let hexadecimal = "0123456789abcdef"

  #"5c753030"
    |> concat(
        #[]
          |> push(at(hexadecimal, byte % 16))
          |> push(at(hexadecimal, byte / 16)),
      )
}

fn require_packet_limit(packet_data: ByteArray) -> ByteArray {
  // Every partial object still needs its two-byte closing quote and brace.
  expect length(packet_data) <= max_packet_bytes - 2
  packet_data
}
