use aiken/builtin
use aiken/collection/list
use aiken/fuzz
use aiken/primitive/bytearray.{length}
use aiken/primitive/int
use ibc/apps/transfer/types/fungible_token_packet_data as packet
use ibc/apps/transfer/types/fungible_token_packet_data.{
  FungibleTokenPacketData, max_amount_bytes, max_denom_bytes, max_packet_bytes,
  max_receiver_bytes, max_sender_bytes,
}
use ibc/apps/transfer/types/ibc_trace
use ibc/utils/text_bytes

// Frozen validation rules from a952ba9a.
fn old_validate_basic(ftpd: FungibleTokenPacketData) -> Bool {
  old_fields_valid(ftpd) && when int.from_utf8(ftpd.amount) is {
    Some(amount) -> and {
        amount > 0,
        text_bytes.trim_ascii_spaces(ftpd.sender) != "",
        text_bytes.trim_ascii_spaces(ftpd.receiver) != "",
        ibc_trace.validate_prefixed_denom(ftpd.denom),
      }
    None -> False
  }
}

fn old_fields_valid(ftpd: FungibleTokenPacketData) -> Bool {
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

const valid =
  FungibleTokenPacketData {
    denom: "uatom",
    amount: "10",
    sender: "alice",
    receiver: "bob",
    memo: "",
  }

fn reference_amount(data) {
  if old_validate_basic(data) {
    int.from_utf8(data.amount)
  } else {
    None
  }
}

fn equivalent(data) {
  let expected = reference_amount(data)
  and {
    packet.validated_amount(data) == expected,
    packet.validate_basic(data) == old_validate_basic(data),
  }
}

test preserves_amount_edge_cases() {
  list.all(
    [
      "",
      "0",
      "00",
      "1",
      "0010",
      "-1",
      "--1",
      "+1",
      "1.0",
      "1-2",
      " 1",
      "1 ",
      #"ff",
      "18446744073709551615",
      builtin.integer_to_bytearray(True, 79, 1),
    ],
    fn(amount) { equivalent(FungibleTokenPacketData { ..valid, amount }) },
  )
}

test preserves_field_limits_and_denom_checks() {
  list.all(
    [
      FungibleTokenPacketData { ..valid, sender: "   " },
      FungibleTokenPacketData { ..valid, receiver: "" },
      FungibleTokenPacketData { ..valid, denom: "transfer/channel-0/" },
      FungibleTokenPacketData { ..valid, denom: "transfer/channel-0/uatom" },
      FungibleTokenPacketData {
        ..valid,
        denom: builtin.integer_to_bytearray(True, 257, 1),
      },
      FungibleTokenPacketData {
        ..valid,
        memo: builtin.integer_to_bytearray(True, 513, 1),
      },
    ],
    equivalent,
  )
}

test parser_equivalence(
  inputs via fuzz.tuple3(
    fuzz.int_between(0, 5),
    fuzz.bytearray_between(0, 520),
    fuzz.one_of(["0", "1", "0010", "--1", "-1", "1.0", "18446744073709551615"]),
  ),
) {
  let (field, bytes, amount) = inputs
  let data = FungibleTokenPacketData { ..valid, amount }
  let data =
    when field is {
      0 -> data
      1 -> FungibleTokenPacketData { ..data, denom: bytes }
      2 -> FungibleTokenPacketData { ..data, amount: bytes }
      3 -> FungibleTokenPacketData { ..data, sender: bytes }
      4 -> FungibleTokenPacketData { ..data, receiver: bytes }
      _ -> FungibleTokenPacketData { ..data, memo: bytes }
    }
  when reference_amount(data) is {
    Some(_) -> fuzz.label(@"fuzz.unit.transfer.amount_parsing.accepted")
    None -> fuzz.label(@"fuzz.unit.transfer.amount_parsing.rejected")
  }
  equivalent(data)
}
