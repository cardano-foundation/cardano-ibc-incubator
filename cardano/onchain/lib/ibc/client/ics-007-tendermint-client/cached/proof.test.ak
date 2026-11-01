use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, PowerChange, Record,
}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}

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

fn shared_changes() -> List<PowerChange> {
  [
    PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 101 },
    PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
    PowerChange { index: 2, pubkey: c, old_power: 25, new_power: 25 },
  ]
}

fn shared_signers() -> List<Leaf> {
  [
    Leaf { index: 0, pubkey: a, power: 101 },
    Leaf { index: 2, pubkey: c, power: 25 },
  ]
}

test cached_leaf_encoding_matches_simple_validator_at_varint_boundaries() {
  list.all(
    [a, b, c],
    fn(key) {
      list.all(
        [
          1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456,
          34359738367, 34359738368, 4398046511103, 4398046511104,
          562949953421311, 562949953421312, 72057594037927935, 72057594037927936,
          1_152_921_504_606_846_975,
        ],
        fn(power) {
          proof.leaf_bytes(key, power) == tm_validator.bytes(
            Validator {
              address: #"",
              pubkey: key,
              voting_power: power,
              proposer_priority: 0,
            },
          )
        },
      )
    },
  )
}

test shared_proof_authenticates_roots_total_and_old_signer_power() {
  let (next, overlap) =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      shared_signers(),
    )
  next == proof.full(
    [
      Leaf { index: 0, pubkey: a, power: 101 },
      Leaf { index: 1, pubkey: b, power: 50 },
      Leaf { index: 2, pubkey: c, power: 25 },
    ],
  ) && overlap == 125 && next.total_power == 176
}

test shared_proof_reuses_an_omitted_subtree_without_requiring_it_to_sign() {
  let (next, overlap) =
    proof.shared_powers(
      proof.full(leaves()),
      changes(),
      [proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
  next.total_power == 176 && overlap == 100
}

test shared_proof_authenticates_a_changed_non_signer() {
  let (next, overlap) =
    proof.shared_powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 100 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
        PowerChange { index: 2, pubkey: c, old_power: 25, new_power: 26 },
      ],
      [],
      [Leaf { index: 0, pubkey: a, power: 100 }],
    )
  next.total_power == 176 && overlap == 100
}

test shared_proof_single_leaf_uses_old_power_for_overlap() {
  let old = proof.full([Leaf { index: 0, pubkey: a, power: 100 }])
  let (next, overlap) =
    proof.shared_powers(
      old,
      [PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 101 }],
      [],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
  next == proof.full([Leaf { index: 0, pubkey: a, power: 101 }]) && overlap == 100
}

test shared_proof_rejects_an_unproved_signer() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      changes(),
      [proof.leaf_hash(c, 25)],
      shared_signers(),
    )
}

test shared_proof_rejects_signer_key_substitution() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [Leaf { index: 0, pubkey: b, power: 101 }],
    )
}

test shared_proof_rejects_signer_power_substitution() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [Leaf { index: 0, pubkey: a, power: 100 }],
    )
}

test shared_proof_rejects_duplicate_signers() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [
        Leaf { index: 0, pubkey: a, power: 101 },
        Leaf { index: 0, pubkey: a, power: 101 },
      ],
    )
}

test shared_proof_rejects_reordered_signers() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [
        Leaf { index: 2, pubkey: c, power: 25 },
        Leaf { index: 0, pubkey: a, power: 101 },
      ],
    )
}

test shared_proof_rejects_a_signer_outside_the_tree() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [Leaf { index: 3, pubkey: c, power: 25 }],
    )
}

test shared_proof_rejects_a_negative_signer_position() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [],
      [Leaf { index: -1, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_forged_old_power() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 99, new_power: 101 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_missing_changed_neighbor() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      list.take(changes(), 1),
      [proof.leaf_hash(b, 50), proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_new_ordering_violation() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 49 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: a, power: 49 }],
    )
}

test shared_proof_rejects_duplicate_disclosed_positions() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 101 },
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 101 },
      ],
      [proof.leaf_hash(b, 50), proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_an_unused_disclosed_leaf() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      list.concat(
        shared_changes(),
        [PowerChange { index: 3, pubkey: a, old_power: 1, new_power: 1 }],
      ),
      [],
      shared_signers(),
    )
}

test shared_proof_rejects_an_unused_hash() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      shared_changes(),
      [proof.leaf_hash(c, 25)],
      shared_signers(),
    )
}

test shared_proof_rejects_a_missing_hash() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      changes(),
      [],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_a_short_hash() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      changes(),
      [#"01"],
      [Leaf { index: 0, pubkey: a, power: 101 }],
    )
}

test shared_proof_rejects_removed_voting_power() fail {
  expect _ =
    proof.shared_powers(
      proof.full(leaves()),
      [
        PowerChange { index: 0, pubkey: a, old_power: 100, new_power: 100 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
        PowerChange { index: 2, pubkey: c, old_power: 25, new_power: 0 },
      ],
      [],
      [Leaf { index: 0, pubkey: a, power: 100 }],
    )
}

test shared_proof_rejects_total_voting_power_overflow() fail {
  let maximum = 1_152_921_504_606_846_975
  let old =
    proof.full(
      [
        Leaf { index: 0, pubkey: a, power: maximum - 1 },
        Leaf { index: 1, pubkey: b, power: 1 },
      ],
    )
  expect _ =
    proof.shared_powers(
      old,
      [
        PowerChange {
          index: 0,
          pubkey: a,
          old_power: maximum - 1,
          new_power: maximum,
        },
        PowerChange { index: 1, pubkey: b, old_power: 1, new_power: 1 },
      ],
      [],
      [Leaf { index: 0, pubkey: a, power: maximum }],
    )
}

test shared_proof_preserves_unchanged_tied_ordering() {
  let old =
    proof.full(
      [
        Leaf { index: 0, pubkey: a, power: 50 },
        Leaf { index: 1, pubkey: b, power: 50 },
        Leaf { index: 2, pubkey: c, power: 25 },
      ],
    )
  let (next, overlap) =
    proof.shared_powers(
      old,
      [
        PowerChange { index: 0, pubkey: a, old_power: 50, new_power: 50 },
        PowerChange { index: 1, pubkey: b, old_power: 50, new_power: 50 },
        PowerChange { index: 2, pubkey: c, old_power: 25, new_power: 26 },
      ],
      [],
      [
        Leaf { index: 0, pubkey: a, power: 50 },
        Leaf { index: 1, pubkey: b, power: 50 },
      ],
    )
  next.total_power == 126 && overlap == 100
}

test shared_proof_rejects_changed_to_reverse_address_tie() fail {
  // Address(b) sorts after Address(a). Lowering the first power to a tie
  // must still check their address order, even though the second is unchanged.
  let old =
    proof.full(
      [
        Leaf { index: 0, pubkey: b, power: 100 },
        Leaf { index: 1, pubkey: a, power: 50 },
        Leaf { index: 2, pubkey: c, power: 25 },
      ],
    )
  expect _ =
    proof.shared_powers(
      old,
      [
        PowerChange { index: 0, pubkey: b, old_power: 100, new_power: 50 },
        PowerChange { index: 1, pubkey: a, old_power: 50, new_power: 50 },
      ],
      [proof.leaf_hash(c, 25)],
      [Leaf { index: 0, pubkey: b, power: 50 }],
    )
}
