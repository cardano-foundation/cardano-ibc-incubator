use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, PowerChange, Record,
}
use ibc/client/ics_007_tendermint_client/cached/verify

const a = #"1111111111111111111111111111111111111111111111111111111111111111"

const b = #"2222222222222222222222222222222222222222222222222222222222222222"

const c = #"3333333333333333333333333333333333333333333333333333333333333333"

fn leaves() -> List<Leaf> {
  [
    Leaf { index: 0, pubkey: a, power: 100 },
    Leaf { index: 1, pubkey: b, power: 50 },
    Leaf { index: 2, pubkey: c, power: 25 },
  ]
}

fn changes() -> List<PowerChange> {
  [
    PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 101 },
    PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
  ]
}

test multiproof_matches_full_uneven_tree() {
  let full = proof.full(leaves())
  proof.root(3, list.take(leaves(), 2), [proof.leaf_hash(c, 25)]) == full.root
}

test delta_authenticates_denominator_and_both_roots() {
  let old = proof.full(leaves())
  let updated = proof.powers(old, changes(), [proof.leaf_hash(c, 25)])
  updated == proof.full(
    [
      Leaf { index: 0, pubkey: a, power: 101 },
      Leaf { index: 1, pubkey: b, power: 50 },
      Leaf { index: 2, pubkey: c, power: 25 },
    ],
  ) && updated.total_power == 176
}

test multiproof_rejects_duplicate_positions() fail {
  expect _ =
    proof.root(
      3,
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 0, pubkey: a, power: 100 },
      ],
      [proof.leaf_hash(b, 50), proof.leaf_hash(c, 25)],
    )
}

test multiproof_rejects_out_of_range_position() fail {
  expect _ =
    proof.root(
      3,
      [Leaf { index: 3, pubkey: c, power: 25 }],
      [proof.full(leaves()).root],
    )
}

test multiproof_rejects_extra_hash() fail {
  expect _ = proof.root(3, leaves(), [proof.leaf_hash(c, 25)])
}

test multiproof_rejects_missing_hash() fail {
  expect _ = proof.root(3, list.take(leaves(), 2), [])
}

test delta_rejects_unauthenticated_old_power() fail {
  expect _ =
    proof.powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 99, new_power: 101 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
    )
}

test delta_rejects_missing_boundary() fail {
  expect _ =
    proof.powers(
      proof.full(leaves()),
      list.take(changes(), 1),
      [proof.leaf_hash(b, 50), proof.leaf_hash(c, 25)],
    )
}

test delta_rejects_new_reordering() fail {
  expect _ =
    proof.powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 49 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
    )
}

test delta_rejects_removed_validator() fail {
  expect _ =
    proof.powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 0 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
    )
}

test full_rejects_duplicate_public_key_at_different_power() fail {
  expect _ =
    proof.full(
      [
        Leaf { index: 0, pubkey: a, power: 100 },
        Leaf { index: 1, pubkey: a, power: 50 },
      ],
    )
}

test full_rejects_total_overflow() fail {
  expect _ =
    proof.full(
      [
        Leaf { index: 0, pubkey: a, power: 1_152_921_504_606_846_975 },
        Leaf { index: 1, pubkey: b, power: 1 },
      ],
    )
}

test cache_rotation_is_bounded_and_deduplicates() {
  let first = Record { root: a, count: 1, total_power: 1 }
  let second = Record { root: b, count: 1, total_power: 2 }
  let third = Record { root: c, count: 1, total_power: 3 }
  verify.rotate(verify.rotate(verify.rotate([], first), second), third) == [
    third, second,
  ] && verify.rotate([third, second], second) == [second, third]
}
