use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/order.{None, Order, Ordered, Unordered}
use ibc/core/ics_004/types/upgrade.{ErrorReceipt, Upgrade, UpgradeFields}
use ibc/utils/bytes

// gogoproto encodings of ibc.core.channel.v1.Upgrade and ErrorReceipt, as
// ibc-go v8 commits and proves them.

fn joined(parts: List<ByteArray>) -> ByteArray {
  list.foldr(parts, #"", bytearray.concat)
}

fn uint(field: Int, value: Int) -> ByteArray {
  expect value >= 0
  if value == 0 {
    #""
  } else {
    joined([bytes.encode_varint(field * 8), bytes.encode_varint(value)])
  }
}

// Non-nullable messages and repeated string elements are always emitted.
fn message(field: Int, value: ByteArray) -> ByteArray {
  joined(
    [
      bytes.encode_varint(field * 8 + 2),
      bytes.encode_varint(bytearray.length(value)),
      value,
    ],
  )
}

fn text(field: Int, value: ByteArray) -> ByteArray {
  if value == #"" {
    #""
  } else {
    message(field, value)
  }
}

fn order_number(order: Order) -> Int {
  when order is {
    None -> 0
    Unordered -> 1
    Ordered -> 2
  }
}

fn height(height: Height) -> ByteArray {
  joined([uint(1, height.revision_number), uint(2, height.revision_height)])
}

pub fn marshal_upgrade_fields(fields: UpgradeFields) -> ByteArray {
  joined(
    [
      uint(1, order_number(fields.ordering)),
      joined(list.map(fields.connection_hops, fn(hop) { message(2, hop) })),
      text(3, fields.version),
    ],
  )
}

pub fn marshal_upgrade(upgrade: Upgrade) -> ByteArray {
  joined(
    [
      message(1, marshal_upgrade_fields(upgrade.fields)),
      message(
        2,
        joined(
          [
            message(1, height(upgrade.timeout.height)),
            uint(2, upgrade.timeout.timestamp),
          ],
        ),
      ),
      uint(3, upgrade.next_sequence_send),
    ],
  )
}

pub fn marshal_error_receipt(receipt: ErrorReceipt) -> ByteArray {
  joined([uint(1, receipt.sequence), text(2, receipt.message)])
}
