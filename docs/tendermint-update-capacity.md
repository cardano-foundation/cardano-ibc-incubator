# Tendermint UpdateClient capacity

This report tracks the whole-transaction capacity work in [issue
#613](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/613).
It is deliberately separate from the validator hashing and lookup optimizations
in [PR #657](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/657):
lower execution cost does not make an oversized transaction serializable.

## Benchmark boundary

The benchmark uses frozen, production-shaped Injective mainnet data with 45
validators. It covers:

- an adjacent update with all 45 commit signatures;
- an adjacent update containing the live mix of 43 commits, one absent vote,
  and one nil vote; and
- a skipped-height update using the same mixed target commit and a trusted
  height 54 blocks earlier.

The deterministic lower-bound shape has two script inputs (HostState and
client), two reference-script inputs, two continuing outputs with inline
datums, one collateral input, two spend redeemers, and one VKey witness. The
HostState update carries two complete 64-level sparse-Merkle sibling lists and
no consensus-state removals. The input client starts with one unexpired trusted
consensus state and the output retains it after inserting the target state.
This one-to-two transition is the minimum valid no-pruning history shape and
isolates validator-set capacity from the pruning growth tracked by issue #557.

The checked-in RPC responses are immutable inputs. CI never fetches live RPC
data. Their manifest records source URLs, hashes, heights, validator counts,
vote flags, voting power, and block/validator hashes.

## Limits

The project evaluates both Cardano's absolute transaction limit and its safer
CI limit:

| Limit                            |                 Value |
| -------------------------------- | --------------------: |
| Cardano `maxTxSize`              |          16,384 bytes |
| Project signing/headroom reserve |             750 bytes |
| Project safe signed size         |          15,634 bytes |
| Transaction memory               |     140,000,000 units |
| Transaction CPU                  | 100,000,000,000 steps |
| Project ex-unit reserve          |                    5% |

## Results

The deterministic lower bounds use the production Gateway encoders for every
datum and redeemer. They are intentionally unbalanced and are not provider
completed, provider evaluated, or ledger submitted; resolving inputs and
adding change can only increase their size. The Aiken figures come from full
validator unit contexts and are summed for the two spending scripts rather
than being extracted from a completed transaction. Every generated report
prints these qualifications.

The execution-unit figures below were measured on `main` at `904e9345`, before
the optimizations in PR #657. CI recomputes them for every relevant Aiken or
encoder change; the serialized-size result is independent of those verifier
optimizations.

| Scenario                               | Signed bytes | Absolute margin | Safe margin |      Memory |            CPU |
| -------------------------------------- | -----------: | --------------: | ----------: | ----------: | -------------: |
| Adjacent, all 45 commits               |       16,791 |            -407 |      -1,157 |  90,008,711 | 29,240,603,426 |
| Adjacent, 43 commit + absent + nil     |       16,698 |            -314 |      -1,064 |  89,631,086 | 29,067,348,964 |
| Non-adjacent, 43 commit + absent + nil |       16,698 |            -314 |      -1,064 | 104,219,365 | 36,032,895,382 |

Even the smallest candidate is 314 bytes over Cardano's absolute transaction
limit before provider completion can add anything. Execution units remain
within the project's 5% reserve; serialized size is the binding constraint.

## Interpretation

These measurements establish the current boundary; they do not choose or
enforce a validator-count ceiling. A follow-up design must reconcile the
supported limit with Injective, introduce any required compact transaction
representation, add matching on-chain and Gateway guards, and test the chosen
limit and limit-plus-one. Explicit two-header misbehaviour evidence requires a
separate capacity result because its payload shape is materially larger than a
normal update.
