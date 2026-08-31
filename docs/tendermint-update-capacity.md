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

The project evaluates the pinned Cardano mainnet parameters and its safer CI
limits. This snapshot is mainnet epoch 651, checked on 2026-08-27; protocol
parameters can change. The source and update policy are recorded in
[Caribic network limits](caribic-network-limits.md).

| Limit                             |                Value |
| --------------------------------- | -------------------: |
| Pinned mainnet `maxTxSize`        |         16,384 bytes |
| Project signing/headroom reserve  |            750 bytes |
| Project safe signed size          |         15,634 bytes |
| Pinned mainnet transaction memory |     16,500,000 units |
| Pinned mainnet transaction CPU    | 10,000,000,000 steps |
| Project ex-unit reserve           |                   5% |

## Results

The deterministic lower bounds use the production Gateway encoders for every
datum and redeemer. They are intentionally unbalanced and are not provider
completed, provider evaluated, or ledger submitted; resolving inputs and
adding change can only increase their size. The Aiken figures come from
isolated unit contexts using the complete validator fixtures and are summed
for the two spending scripts. They are not extracted from a completed
transaction. Every generated report prints these qualifications.

The execution-unit figures below were measured on `main` at `2c1c8c1f` and
include the verifier optimizations in PR #657. CI recomputes them for every
relevant Aiken or encoder change; the serialized-size result is independent of
those verifier optimizations.

| Scenario                               | Signed bytes | Pinned max margin | Safe margin |     Memory |            CPU |
| -------------------------------------- | -----------: | ----------------: | ----------: | ---------: | -------------: |
| Adjacent, all 45 commits               |       16,791 |              -407 |      -1,157 | 72,091,542 | 23,675,599,153 |
| Adjacent, 43 commit + absent + nil     |       16,698 |              -314 |      -1,064 | 71,866,206 | 23,551,367,592 |
| Non-adjacent, 43 commit + absent + nil |       16,698 |              -314 |      -1,064 | 80,979,625 | 28,348,286,191 |

Even the smallest candidate is 314 bytes over the pinned mainnet transaction
maximum before provider completion can add anything. Every measured scenario
also exceeds the pinned mainnet transaction memory and CPU maxima. Transaction
size and execution cost are both binding constraints.

## Matched direct and SP1 comparison

The released SP1 regression proof's public values match the client parameters,
heights 180315956 to 180315957, and trusted and new consensus states used by the
first direct scenario. The artifact metadata records 45 validators, and both
Cardano transaction shapes use a one-to-two history boundary. The raw
Tendermint header is a private SP1 input and is not part of the tracked proof
artifact, so this benchmark does not claim byte-for-byte raw-header identity.

The comparison generator builds both transaction shapes with the production
Gateway encoders. The direct transaction has two script references and two
spend redeemers. The SP1 transaction has the same two script spends plus a
third proof-script reference, a zero withdrawal, and its reward redeemer. Its
451-byte proof redeemer contains the tracked 288-byte wrapped proof. The
generator also reconstructs and checks the exact 768-byte Eureka public-value
payload bound by that proof.

| Path         | Signed bytes | Pinned max margin | Memory-context sum | Pinned max margin | CPU-context sum | Pinned max margin |
| ------------ | -----------: | ----------------: | -----------------: | ----------------: | --------------: | ----------------: |
| Direct Aiken |       16,791 |              -407 |         57,412,347 |       -40,912,347 |  19,306,796,067 |    -9,306,796,067 |
| SP1 proof    |        6,041 |            10,343 |         15,312,458 |         1,187,542 |   8,237,019,661 |     1,762,980,339 |

Margins in this table are against the pinned Cardano mainnet parameters. The
SP1 structural size lower bound and summed execution contexts are numerically below the
project's safer guides of 15,634 signed bytes, 15,675,000 memory units, and
9,500,000,000 CPU steps. That is not yet a completed-transaction budget result:
the isolated Aiken contexts do not all carry the modeled three-input,
two-output, three-redeemer transaction. A matched full-transaction ledger
evaluation is still required. “Gas” on Cardano is represented by separate
memory and CPU execution-unit budgets rather than one scalar value.

The unit-context estimates were produced by the Aiken 1.1.21 test evaluator.
This report has not established that its evaluator and cost model match the
pinned epoch-651 or current mainnet cost model, so the execution margins are
branch-local estimates. The machine-readable data records each selected test's
units and a digest of those values.

![Three horizontal comparisons for structural signed bytes and summed Aiken memory and CPU contexts. The direct structural size and execution-context sums exceed the pinned mainnet maxima. The SP1 lower bound and context sums are below the guides, but a matched full-transaction ledger evaluation is still required.](assets/tendermint-update-budget-comparison.svg)

_The size figures are deterministic, unbalanced structural lower bounds. The
execution figures are sums from isolated Aiken unit contexts, not values
from a completed, provider-evaluated, or ledger-submitted transaction. They do
not establish that the completed SP1 transaction fits the safe execution
budget._

The earlier direct table remains the frozen `main` regression baseline at
`2c1c8c1f`. The matched chart is generated from the SP1 feature implementation,
whose separate legacy and proof validators change the Aiken unit-context
figures. Mixing the historical direct execution figures with feature-branch
SP1 figures would not be a reproducible branch-to-branch comparison.

## Validator-count encoding

The direct-path line below uses production-shaped encodings resized to 4, 16,
32, 45, 64, 100, and 200 validators. Resizing preserves field widths and
all-signed slot structure, but the generated cases are not consensus-valid
Tendermint headers. They measure CBOR growth, not successful verification. The
SP1 guide is horizontal because validator data is absent from its Cardano
payload. It is validator-independent at this one-to-two-state/field-width
boundary, not globally fixed: transaction size can still vary with history and
integer widths. Only its 45-validator point is backed by the tracked real
proof.

![Line chart of structural signed transaction bytes by validator count. Direct encoding rises from 7,112 bytes at 4 validators to 53,371 bytes at 200 and crosses the pinned mainnet maximum by 45; the SP1 guide remains at 6,041 bytes across validator counts at the matched one-to-two-state/field-width boundary.](assets/tendermint-update-validator-scaling.svg)

_This chart must not be used to infer prover latency or a validator-count
ceiling. In one Apple M5 run, local guest execution took 0.907 seconds and an
estimated 3,140,508 PGU at 45 validators, versus 9.682 seconds and an estimated
19,714,926 PGU at 200. No network proof was submitted, so these are not proof
latency or actual network PGU measurements. The 200-validator case was only
mock-proved._

## Operational tradeoffs

| Dimension                        | Direct ICS-07                                                                   | SP1 proof path                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cardano payload                  | Full header and validator data; 11,285-byte client redeemer in the matched case | 288-byte wrapped proof; 451-byte complete proof redeemer                                                                                                                                                                                            |
| Validator-count effect           | Cardano size and verification work grow with the validator set                  | The proof excludes validator data, so Cardano size is validator-independent at the matched one-to-two-state/field-width boundary; guest and prover work remain off-chain                                                                            |
| Off-chain prover                 | None                                                                            | Required for liveness; invalid proofs are still rejected on-chain                                                                                                                                                                                   |
| Recorded real proof              | Not applicable                                                                  | Real 45-validator Injective update with a development wrapper setup: 590.383 seconds and 8.99 GB peak resident memory for SP1 proving. One later persistent-wrapper process took 134.319 seconds from start to readiness, wrapped twice in 9.775701833 and 9.61133575 seconds, and took 159.22 seconds total with approximately 4.23 GB peak resident memory. These are single observations, not distributions |
| Proof setup                      | None                                                                            | Current development setup: 1,192,065 constraints, 216.715 seconds, 62.4 MB R1CS, and 505.3 MB proving key; production setup remains separate work                                                                                                   |
| Largest additional guest run     | Not applicable                                                                  | Generated 200-validator update: executed and mock-proved only                                                                                                                                                                                       |
| Consensus-state retention        | Up to 300 states                                                                | Up to 10 states                                                                                                                                                                                                                                     |
| Client-path Aiken import closure | 6,138 nonblank, non-comment lines; 1,113 direct-only                            | 6,143 lines across two entry points; 1,118 SP1-only; 5,025 lines are shared with direct                                                                                                                                                             |
| Unparameterized blueprint code   | 14,899 bytes for the client validator                                           | 2,576-byte client validator plus 7,999-byte proof withdrawal validator                                                                                                                                                                              |

The source-line count follows transitive local imports from the client and
proof Aiken entry points and excludes tests, generated fixtures, and the shared
HostState validator entry point. It is an audit-surface indicator, not a measure
of total system complexity: it excludes Gateway orchestration, the Rust/Go
prover and wrapper, and the reused upstream Eureka guest. Blueprint bytes are
measured before parameter application and are not a deployment-fee estimate.

Transaction fees, direct-path end-to-end latency, confirmation latency,
throughput, and prover infrastructure cost are not reported because this
branch does not contain comparable measurements. A Cardano fee comparison
requires balanced, completed transactions evaluated with the same pinned
protocol parameters.

## Reproducing the generated report

Generate the four focused Aiken unit results, then write or check the JSON and
SVG assets:

```sh
(cd cardano/onchain && \
  aiken build --deny && \
  aiken check --deny --plain-numbers --exact-match \
    -m 'host_state_stt.{host_update_client_capacity_minimum_history_succeeds}' \
    -m 'spending_client_capacity.{update_client_capacity_adjacent_all_signed_45_succeeds}' \
    -m 'spending_client.{proof_update_budget_gate_succeeds}' \
    -m 'ibc/client/ics_007_tendermint_client/proof_update/state.{full_transaction_accepts_exact_proof_update}' \
    > ../../aiken-check.json)

npm run --prefix cardano/gateway write:tendermint-benchmark-report
```

Run `npm run --prefix cardano/gateway check:tendermint-benchmark-report` to fail
when a generated asset is stale. The
[machine-readable benchmark data](assets/tendermint-update-benchmark.json)
records the exact transaction shapes, source tests, scaling points,
implementation-surface scope, and qualifications used by both charts.

## Interpretation

These measurements remain the regression boundary for the direct ICS-07 path.
They do not show that the standard is wrong or establish a validator-count
ceiling. They show that carrying the standard Tendermint header, validator sets,
and signatures into a Cardano transaction does not fit for Injective's current
validator set.

The SP1 path removes that validator-dependent Cardano payload. The released IBC
Eureka program verifies the Tendermint header off-chain and the Cardano
transaction carries a 288-byte proof. Aiken verifies that fixed-size proof and
binds its output to the client and HostState transitions. The same program
executed a generated 200-validator update without chain-specific code, although
that case has only been mock-proved; no full SP1 Groth16 or wrapped proof was
generated or timed.

Validator count therefore affects prover work, not Cardano transaction size or
proof-verification cost. Consensus-state history is still a separate Cardano
cost because the client datum and HostState commitment transition grow with the
number of retained states. Proof-based clients therefore retain at most 10
consensus states. CI exercises the isolated transition contexts at the
10-state boundary and checks that 11, 25, and 50-state inputs are rejected. A
completed, provider-evaluated 10-state transaction still needs to be measured.
The direct ICS-07 path keeps its existing 300-state limit.
