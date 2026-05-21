# Aiken Fuzzing Invariants

This document records the protocol invariants currently exercised by the
Aiken property-based fuzzing suite. It is intentionally limited to invariants
that are covered by existing fuzz/property tests and their CI-enforced labels.

The fuzz suite currently covers trace-registry rollover transitions in
`cardano/onchain/validators/trace_registry_rollover.test.ak`.

## Trace Registry Rollover

Required CI labels:

- `trace.rollover.valid`
- `trace.rollover.invalid_non_target_bucket_changed`
- `trace.rollover.invalid_old_shard_not_preserved`
- `trace.rollover.invalid_new_shard_not_exact_entry`
- `trace.rollover.invalid_missing_voucher_mint`

### Valid Rollover Transition

Covered by `trace.rollover.valid`.

The rollover property constructs a near-production rollover transaction and
requires both the shard-side and directory-side validators to accept it. The
valid transition must satisfy these invariants:

- Exactly one target directory bucket moves from the previous active shard to a
  new active shard.
- The previous active shard is archived under the target bucket.
- The previous active shard output is preserved byte-for-byte as the archived
  shard output.
- The new active shard is fresh and contains exactly the newly inserted trace
  entry.
- The inserted trace entry uses the expected `voucher_hash` and `full_denom`.
- The transaction mints the new active shard NFT.
- The transaction includes the matching voucher mint that authorizes the trace
  registry write.
- The directory-side `AdvanceDirectory` redeemer and shard-side
  `RolloverInsertTrace` redeemer agree on bucket, voucher hash, full denom, old
  active shard, and new active shard.

### Directory Bucket Isolation

Covered by `trace.rollover.invalid_non_target_bucket_changed`.

The mutation changes only an unrelated non-target bucket. The rollover must be
rejected, proving these invariants:

- Rollover may modify only the target bucket.
- Non-target buckets must remain byte-for-byte unchanged.
- A valid target bucket transition cannot hide unrelated directory drift.

### Archived Shard Preservation

Covered by `trace.rollover.invalid_old_shard_not_preserved`.

The mutation changes the archived copy of the previous active shard. The
rollover must be rejected, proving these invariants:

- The archived shard must preserve the previous active shard contents exactly.
- Existing trace entries cannot be dropped, replaced, or rewritten during
  rollover.
- Rollover cannot use archiving as a path to mutate historical trace data.

### New Active Shard Freshness

Covered by `trace.rollover.invalid_new_shard_not_exact_entry`.

The mutation adds an extra old entry to the new active shard. The rollover must
be rejected, proving these invariants:

- The new active shard must contain exactly the newly inserted trace entry.
- The new active shard cannot inherit old shard entries.
- Rollover cannot duplicate or carry forward unrelated registry entries into
  the fresh shard.

### Voucher Mint Coupling

Covered by `trace.rollover.invalid_missing_voucher_mint`.

The mutation removes the matching voucher mint while leaving the new shard NFT
mint. The rollover must be rejected, proving these invariants:

- A rollover registry write must be coupled to a matching voucher mint.
- Minting only the new active shard NFT is not sufficient authorization.
- The trace registry cannot be written arbitrarily without the corresponding
  voucher asset flow.

## Current Coverage Boundary

The current fuzzing suite does not yet provide property-level invariant
coverage for:

- client creation or update,
- connection handshakes,
- channel handshakes,
- packet send, receive, acknowledgement, or timeout,
- transfer escrow/refund value transitions,
- first voucher mint metadata,
- existing voucher mint flows,
- misbehaviour freezing.

Those areas may have unit or integration tests elsewhere, but they are not
currently represented in the CI-enforced Aiken fuzz label catalog.
