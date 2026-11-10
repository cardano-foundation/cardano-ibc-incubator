use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/fuzz
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/transaction.{OutputReference}
use ibc/apps/transfer/packet_accounting as accounting
use ibc/apps/transfer/packet_batch.{LaneInputUpdate, Receive}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_lane_datum
use ibc/core/ics_004/types/packet.{Packet}
use ibc/testing/packet_accounting_reference as reference

const ref =
  OutputReference {
    transaction_id: #"abababababababababababababababababababababababababababababababab",
    output_index: 0,
  }

const height = Height { revision_number: 0, revision_height: 1 }

const packet =
  Packet {
    sequence: 1,
    source_port: "transfer",
    source_channel: "channel-7",
    destination_port: "transfer",
    destination_channel: "channel-0",
    data: #"",
    timeout_height: height,
    timeout_timestamp: 1,
  }

const lane = packet_lane_datum.empty("transfer", "channel-0", 1, 16)

// Canonical maps of up to eight keys with a chosen hit or insertion position.
test sorted_updates_match_reference(
  inputs via fuzz.tuple8(
    fuzz.int_between(0, 8),
    fuzz.int_between(0, 8),
    fuzz.bool(),
    fuzz.bool(),
    fuzz.int_between(-10000, 10000),
    fuzz.int_between(1, 10000),
    fuzz.int_between(0, 2),
    fuzz.bool(),
  ),
) {
  let (
    count,
    position,
    requested_present,
    returning,
    old_amount,
    amount,
    outstanding,
    cancel,
  ) = inputs
  let denom =
    if returning {
      "transfer/channel-7/coin"
    } else {
      "coin"
    }
  let target =
    crypto.sha2_256(
      if returning {
        "coin"
      } else {
        "transfer/channel-0/coin"
      },
    )
  let present = requested_present && count > 0
  let lower_count =
    position % (
      count + if present {
        0
      } else {
        1
      }
    )
  let lower =
    list.map(
      list.range(1, lower_count),
      fn(i) { Pair(builtin.integer_to_bytearray(True, 32, i), 100) },
    )
  let upper =
    list.map(
      list.range(
        1,
        count - lower_count - if present {
          1
        } else {
          0
        },
      ),
      fn(i) {
        Pair(
          builtin.cons_bytearray(255, builtin.integer_to_bytearray(True, 31, i)),
          -100,
        )
      },
    )
  let value =
    if cancel {
      if returning {
        amount
      } else {
        -amount
      }
    } else {
      old_amount
    }
  let entries =
    list.concat(
      lower,
      if present {
        [Pair(target, value), ..upper]
      } else {
        upper
      },
    )
  let old =
    packet_lane_datum.PacketLaneDatum {
      ..lane,
      balances: entries,
      commitments: when outstanding is {
        0 -> []
        1 -> [Pair(1, #"ab")]
        _ -> [Pair(1, #"ab"), Pair(17, #"ab")]
      },
    }
  let op =
    Receive {
      packet,
      data: FungibleTokenPacketData {
        denom,
        amount: builtin.encode_utf8(int.to_string(amount)),
        sender: "alice",
        receiver: "bob",
        memo: #"",
      },
      proof_height: height,
      proof_index: 0,
      lane: LaneInputUpdate { input_ref: ref, updates: [] },
      liquidity_refs: [],
    }
  let actual = accounting.balance_after(transaction.placeholder, old, op)
  let expected = reference.balance_after(transaction.placeholder, old, op)
  if present {
    fuzz.label(@"fuzz.unit.transfer.balance_update.existing_key")
  } else {
    fuzz.label(@"fuzz.unit.transfer.balance_update.new_key")
  }
  if cancel && present {
    if outstanding > 0 {
      fuzz.label(@"fuzz.unit.transfer.balance_update.reserved_zero")
    } else {
      fuzz.label(@"fuzz.unit.transfer.balance_update.released_zero")
    }
  } else {
    fuzz.label(@"fuzz.unit.transfer.balance_update.ordinary_delta")
  }
  let keys = pairs.keys(actual)
  and {
    actual == expected,
    list.length(entries) == count,
    keys == list.sort(list.unique(keys), bytearray.compare),
    outstanding > 0 || list.all(actual, fn(entry) { entry.2nd != 0 }),
  }
}
