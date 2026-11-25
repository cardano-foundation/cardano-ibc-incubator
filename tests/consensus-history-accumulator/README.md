# Private consensus history experiment

The append-only prototype lowers the fee of a complete cache-hit update, but it does not meet the requested saving of 0.279 ADA per update by itself. This is a benchmark experiment. It does not enable a new history format in a deployed validator or change normal routing.

## Measurement

The runner makes three separate copies of the on-chain source. The baseline builds the current implementation. The diagnostic ablation removes only the private history insertion check. It retains the history witness and is deliberately insecure. Its cost estimates the contribution of the existing check, not an acceptable update path or an absolute bound on every possible representation change. The candidate replaces that check with a verified frontier append.

Each case builds, evaluates, signs and submits a complete update to the emulator. It uses the retained real 45-validator header with 17 signatures. Both the client/cache transition and public HostState update remain in the transaction. The fixture seeds authenticated pre-existing history to test capacity. These measurements do not demonstrate creation or migration of an accumulator client.

The cases cover empty history, 1, 31, 32, 100, 255, 256, 4,095 and 6,000 archived checkpoints. The 4,095 case exercises twelve successive carry merges. Cases describe capacity, not a measured production distribution.

| Archived checkpoints | Current fee, ADA | Accumulator fee, ADA | Saving, ADA |
| --- | ---: | ---: | ---: |
| 0 | 2.025 | 1.862 | 0.163 |
| 100 | 2.031 | 1.874 | 0.157 |
| 4,095 | 2.041 | 1.901 | 0.140 |
| 6,000 | 2.041 | 1.889 | 0.152 |

Across the nine cases, removing the insertion check saves 0.172–0.177 ADA. The actual accumulator saves 0.140–0.167 ADA. Neither range reaches 0.279 ADA. The accumulator update uses at most 9,020,532 memory units and 4,796,177,875 CPU units. It references 39,028 script bytes compared with 39,716 bytes today. Its largest signed transaction is 5,767 bytes. All 27 measured transactions passed signature, fee and resource checks. All 73 standalone accumulator checks and three complete-transaction rejection cases passed.

The checked-in `results.json` contains fees in lovelace, transaction hashes, execution budgets, signed sizes, reference bytes and fee components. Full signed transactions, compiler blueprints and test reports are workflow artifacts. No generated transaction dump is checked in. Fees include the signed transaction size, execution prices and tiered reference-script charge. The runner verifies wallet signatures and reconciles each fee to these components and the builder's small fee padding. All positive candidates must retain the existing 5% size, memory and CPU reserve.

## Construction and limits

The private root is explicitly versioned as `02 || uint64_be(count) || tree_hash`. It is 41 bytes. The tree uses the leaf and node domains and split rule from [RFC 9162, section 2.1](https://www.rfc-editor.org/rfc/rfc9162.html#section-2.1). Compact frontier peaks appear from smallest to largest subtree. The authenticated count determines their exact shape. The verifier checks the old root before it appends the exact checkpoint returned by `consensus_history.from_client()`. The serialized leaf includes the client token, height, consensus state and both processing fields. The new commitment contains exactly `count + 1` leaves.

The standalone inclusion verifier checks the position against the authenticated count and requires an exact proof with 32-byte hashes. A separate full-tree builder cross-checks frontier roots at fifteen sizes through 6,001 leaves. Tests reject missing, extra, reordered, malformed and forged proof material, invalid positions, unsupported roots and counter overflow. Complete candidate tests also reject a changed history output, a bad signature and an insufficient quorum.

The public IBC sparse tree, its depth, public commitment bytes and frozen Go modules are unchanged. The nine extra private datum bytes imply a calculated additional minimum reserve of 0.039 ADA at 4,310 lovelace per byte. That is committed capital rather than a recurring fee. The test client outputs already have sufficient ADA, so this is not a measured wallet debit.

## Adoption boundary

Ordinary append and standalone inclusion are implemented only in the isolated benchmark build. Historical packet proofs, expiry checks and misbehaviour continue to use the existing implementation in production. Their accumulator integration has not been implemented or benchmarked. There is no claim that the candidate is ready for deployment.

A production proposal must initialize the versioned empty root through authenticated client creation or define a separately authorized migration. Existing 32-byte roots must retain their old meaning. It must dispatch historical membership by version while preserving client/height binding, processing metadata and expiry. Freezing must preserve the exact root and count. Upgrade and recovery must authenticate and append the subject's previous tip and preserve its archive, including revision ordering rules. Recovery must never copy the substitute's private archive. Unsupported transitions must fail closed. Retirement must retain the current paired client/cache cleanup. The experiment does not bypass any of these operations in the normal implementation and does not add pruning.

The current results justify keeping this as a possible part of a larger client optimization. They do not justify claiming that this change alone clears the overall 5% economic hurdle. Throughput, latency, historical-read costs, staged finalization costs and long-run production savings are unmeasured here.

## Reproduce

Use Aiken 1.1.24, Deno 2.9.6 and Python 3. Run from the repository root:

```sh
python3 tests/consensus-history-accumulator/run.py --output /tmp/history-experiment
```

The runner patches only copies under the output directory. It never replaces the checkout's source or blueprint. The retained parameter file pins the 350-entry Plutus V3 cost model, 16.5 million memory units, 10 billion CPU units and 16,384-byte signed-size limit. Its fees use mainnet prices of 44 lovelace per byte plus 155,381 lovelace, 0.0577 lovelace per memory unit, 0.0000721 lovelace per CPU unit and a 15-lovelace reference price increasing by 1.2 at each 25,600-byte tier. Results are signed-emulator measurements under those pinned parameters, not live-chain measurements.
