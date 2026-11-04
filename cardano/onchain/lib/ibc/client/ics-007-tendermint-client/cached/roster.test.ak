use aiken/builtin
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/roster.{Roster}
use ibc/client/ics_007_tendermint_client/cached/test_support
use ibc/client/ics_007_tendermint_client/cached/types.{Leaf}

fn sample(power: Int) -> Roster {
  let leaves = [
    Leaf { index: 0, pubkey: test_support.a, power },
    Leaf { index: 1, pubkey: test_support.b, power: 1 },
  ]
  let summary = proof.full(leaves)
  Roster {
    root: summary.root,
    count: summary.count,
    total_power: summary.total_power,
    rows: test_support.target_bytes(leaves),
  }
}

test empty_creation_and_full_admission() {
  let r = sample(3)
  roster.admit([], [], []) && roster.admit([r], [roster.record(r)], [[0, 1]])
}

test refresh_reuses_only_exact_authenticated_records() {
  let old = sample(3)
  let next = sample(4)
  roster.admit_changes(
    [old],
    [next, old],
    [roster.record(next), roster.record(old)],
    [[0, 1], []],
  )
}

test duplicate_roots_rejected() fail {
  let r = sample(3)
  roster.admit([r, r], [roster.record(r), roster.record(r)], [[0, 1], [0, 1]])
}

test third_record_rejected() fail {
  let r = sample(3)
  roster.admit([r, r, r], [roster.record(r)], [[0, 1]])
}

test roster_count_bound_rejected() fail {
  let r = sample(3)
  let bad = Roster { ..r, count: 129 }
  roster.admit([bad], [roster.record(bad)], [[0, 1]])
}

test forged_total_rejected() fail {
  let r = sample(3)
  let bad = Roster { ..r, total_power: 1 }
  roster.admit([bad], [roster.record(bad)], [[0, 1]])
}

test altered_rows_cannot_inherit_authentication_from_a_root() fail {
  let r = sample(3)
  let changed = Roster {
    ..r,
    rows: builtin.append_bytearray(
      test_support.b,
      builtin.slice_bytearray(32, 48, r.rows),
    ),
  }
  roster.admit_changes([r], [changed], [roster.record(r)], [[]])
}

test fresh_rows_cannot_omit_key_uniqueness_evidence() fail {
  let r = sample(3)
  roster.admit([r], [roster.record(r)], [[]])
}
