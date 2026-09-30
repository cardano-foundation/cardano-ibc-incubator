use aiken/collection/list
use aiken/primitive/bytearray
use ibc/core/ics_004/packet_balances

fn key(n: Int) -> ByteArray {
  bytearray.from_int_big_endian(n, 32)
}

test accounting_capacity_is_bounded_and_canonical() {
  let full = list.map(list.range(1, 8), fn(n) { Pair(key(n), n) })
  and {
    packet_balances.valid(full),
    !packet_balances.valid(list.concat(full, [Pair(key(9), 1)])),
    !packet_balances.valid([Pair("unbounded denom", 1)]),
    !packet_balances.valid([Pair(key(1), 0)]),
    !packet_balances.valid([Pair(key(1), 1), Pair(key(1), 2)]),
  }
}

test compaction_cannot_create_offsetting_debt() {
  !packet_balances.conserved([], [], [Pair(key(1), 1)], [Pair(key(1), -1)])
}

test compaction_can_swap_assets_between_full_lanes_to_admit_returns() {
  let left = list.map(list.range(1, 8), fn(n) { Pair(key(n), 10) })
  let right = list.map(list.range(9, 16), fn(n) { Pair(key(n), 20) })
  packet_balances.conserved(left, right, right, left)
}

test compaction_cannot_fragment_an_obligation_to_fill_more_lanes() {
  !packet_balances.conserved(
    [Pair(key(1), 10)],
    [],
    [Pair(key(1), 5)],
    [Pair(key(1), 5)],
  )
}
