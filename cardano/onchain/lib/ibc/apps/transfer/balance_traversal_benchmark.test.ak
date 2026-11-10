use aiken/builtin
use aiken/collection/list
use aiken/crypto
use cardano/transaction.{OutputReference}
use ibc/apps/transfer/packet_accounting as accounting
use ibc/apps/transfer/packet_batch.{LaneInputUpdate, Receive}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_lane_datum
use ibc/core/ics_004/types/packet.{Packet}
use ibc/testing/packet_accounting_reference as reference

const target = crypto.sha2_256("transfer/channel-0/coin")

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

const op =
  Receive {
    packet,
    data: FungibleTokenPacketData {
      denom: "coin",
      amount: "10",
      sender: "alice",
      receiver: "bob",
      memo: #"",
    },
    proof_height: height,
    proof_index: 0,
    lane: LaneInputUpdate { input_ref: ref, updates: [] },
    liquidity_refs: [],
  }

const lane = packet_lane_datum.empty("transfer", "channel-0", 1, 16)

const pending = [Pair(1, #"ab")]

fn balances(count, position, present, target_balance) {
  let lower =
    list.map(
      list.range(1, position),
      fn(i) { Pair(builtin.integer_to_bytearray(True, 32, i), 100) },
    )
  let upper_count =
    count - position - if present {
      1
    } else {
      0
    }
  let upper =
    list.map(
      list.range(1, upper_count),
      fn(i) {
        Pair(
          builtin.cons_bytearray(255, builtin.integer_to_bytearray(True, 31, i)),
          100,
        )
      },
    )
  list.concat(
    lower,
    if present {
      [Pair(target, target_balance), ..upper]
    } else {
      upper
    },
  )
}

fn state(entries, commitments) {
  packet_lane_datum.PacketLaneDatum { ..lane, balances: entries, commitments }
}

const before_empty_insert = state(balances(0, 0, False, 100), pending)

const after_empty_insert =
  reference.balance_after(transaction.placeholder, before_empty_insert, op)

test benchmark_empty_insert() {
  accounting.balance_after(transaction.placeholder, before_empty_insert, op) == after_empty_insert
}

const before_1_hit_0 = state(balances(1, 0, True, 100), pending)

const after_1_hit_0 =
  reference.balance_after(transaction.placeholder, before_1_hit_0, op)

test benchmark_1_hit_0() {
  accounting.balance_after(transaction.placeholder, before_1_hit_0, op) == after_1_hit_0
}

const before_4_hit_0 = state(balances(4, 0, True, 100), pending)

const after_4_hit_0 =
  reference.balance_after(transaction.placeholder, before_4_hit_0, op)

test benchmark_4_hit_0() {
  accounting.balance_after(transaction.placeholder, before_4_hit_0, op) == after_4_hit_0
}

const before_4_hit_2 = state(balances(4, 2, True, 100), pending)

const after_4_hit_2 =
  reference.balance_after(transaction.placeholder, before_4_hit_2, op)

test benchmark_4_hit_2() {
  accounting.balance_after(transaction.placeholder, before_4_hit_2, op) == after_4_hit_2
}

const before_4_hit_3 = state(balances(4, 3, True, 100), pending)

const after_4_hit_3 =
  reference.balance_after(transaction.placeholder, before_4_hit_3, op)

test benchmark_4_hit_3() {
  accounting.balance_after(transaction.placeholder, before_4_hit_3, op) == after_4_hit_3
}

const before_8_hit_0 = state(balances(8, 0, True, 100), pending)

const after_8_hit_0 =
  reference.balance_after(transaction.placeholder, before_8_hit_0, op)

test benchmark_8_hit_0() {
  accounting.balance_after(transaction.placeholder, before_8_hit_0, op) == after_8_hit_0
}

const before_8_hit_4 = state(balances(8, 4, True, 100), pending)

const after_8_hit_4 =
  reference.balance_after(transaction.placeholder, before_8_hit_4, op)

test benchmark_8_hit_4() {
  accounting.balance_after(transaction.placeholder, before_8_hit_4, op) == after_8_hit_4
}

const before_8_hit_7 = state(balances(8, 7, True, 100), pending)

const after_8_hit_7 =
  reference.balance_after(transaction.placeholder, before_8_hit_7, op)

test benchmark_8_hit_7() {
  accounting.balance_after(transaction.placeholder, before_8_hit_7, op) == after_8_hit_7
}

const before_1_insert_0 = state(balances(1, 0, False, 100), pending)

const after_1_insert_0 =
  reference.balance_after(transaction.placeholder, before_1_insert_0, op)

test benchmark_1_insert_0() {
  accounting.balance_after(transaction.placeholder, before_1_insert_0, op) == after_1_insert_0
}

const before_1_insert_1 = state(balances(1, 1, False, 100), pending)

const after_1_insert_1 =
  reference.balance_after(transaction.placeholder, before_1_insert_1, op)

test benchmark_1_insert_1() {
  accounting.balance_after(transaction.placeholder, before_1_insert_1, op) == after_1_insert_1
}

const before_4_insert_0 = state(balances(4, 0, False, 100), pending)

const after_4_insert_0 =
  reference.balance_after(transaction.placeholder, before_4_insert_0, op)

test benchmark_4_insert_0() {
  accounting.balance_after(transaction.placeholder, before_4_insert_0, op) == after_4_insert_0
}

const before_4_insert_2 = state(balances(4, 2, False, 100), pending)

const after_4_insert_2 =
  reference.balance_after(transaction.placeholder, before_4_insert_2, op)

test benchmark_4_insert_2() {
  accounting.balance_after(transaction.placeholder, before_4_insert_2, op) == after_4_insert_2
}

const before_4_insert_4 = state(balances(4, 4, False, 100), pending)

const after_4_insert_4 =
  reference.balance_after(transaction.placeholder, before_4_insert_4, op)

test benchmark_4_insert_4() {
  accounting.balance_after(transaction.placeholder, before_4_insert_4, op) == after_4_insert_4
}

const before_7_insert_0 = state(balances(7, 0, False, 100), pending)

const after_7_insert_0 =
  reference.balance_after(transaction.placeholder, before_7_insert_0, op)

test benchmark_7_insert_0() {
  accounting.balance_after(transaction.placeholder, before_7_insert_0, op) == after_7_insert_0
}

const before_7_insert_3 = state(balances(7, 3, False, 100), pending)

const after_7_insert_3 =
  reference.balance_after(transaction.placeholder, before_7_insert_3, op)

test benchmark_7_insert_3() {
  accounting.balance_after(transaction.placeholder, before_7_insert_3, op) == after_7_insert_3
}

const before_7_insert_7 = state(balances(7, 7, False, 100), pending)

const after_7_insert_7 =
  reference.balance_after(transaction.placeholder, before_7_insert_7, op)

test benchmark_7_insert_7() {
  accounting.balance_after(transaction.placeholder, before_7_insert_7, op) == after_7_insert_7
}

const before_reserved_zero = state(balances(8, 4, True, -10), pending)

const after_reserved_zero =
  reference.balance_after(transaction.placeholder, before_reserved_zero, op)

test benchmark_reserved_zero() {
  accounting.balance_after(transaction.placeholder, before_reserved_zero, op) == after_reserved_zero
}

const before_released_zero = state(balances(8, 4, True, -10), [])

const after_released_zero =
  reference.balance_after(transaction.placeholder, before_released_zero, op)

test benchmark_released_zero() {
  accounting.balance_after(transaction.placeholder, before_released_zero, op) == after_released_zero
}
