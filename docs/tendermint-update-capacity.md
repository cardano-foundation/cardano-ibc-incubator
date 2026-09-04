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

| Limit                            |                Value |
| -------------------------------- | -------------------: |
| Cardano `maxTxSize`              |         16,384 bytes |
| Project signing/headroom reserve |            750 bytes |
| Project safe signed size         |         15,634 bytes |
| Transaction memory               |     16,500,000 units |
| Transaction CPU                  | 10,000,000,000 steps |
| Project ex-unit reserve          |                   5% |

## Results

The deterministic lower bounds use the production Gateway encoders for every
datum and redeemer. They are intentionally unbalanced and are not provider
completed, provider evaluated, or ledger submitted; resolving inputs and
adding change can only increase their size. The Aiken figures come from full
validator unit contexts and are summed for the two spending scripts rather
than being extracted from a completed transaction. Every generated report
prints these qualifications.

The execution-unit figures below were measured on `main` at `2c1c8c1f` and
include the verifier optimizations in PR #657. CI recomputes them for every
relevant Aiken or encoder change; the serialized-size result is independent of
those verifier optimizations.

| Scenario                               | Signed bytes | Absolute margin | Safe margin |     Memory |            CPU |
| -------------------------------------- | -----------: | --------------: | ----------: | ---------: | -------------: |
| Adjacent, all 45 commits               |       16,791 |            -407 |      -1,157 | 72,091,542 | 23,675,599,153 |
| Adjacent, 43 commit + absent + nil     |       16,698 |            -314 |      -1,064 | 71,866,206 | 23,551,367,592 |
| Non-adjacent, 43 commit + absent + nil |       16,698 |            -314 |      -1,064 | 80,979,625 | 28,348,286,191 |

Even the smallest candidate is 314 bytes over Cardano's absolute transaction
limit before provider completion can add anything. Every measured scenario
also exceeds Cardano mainnet's transaction memory and CPU limits. Transaction
size and execution cost are both binding constraints.

## Interpretation

These measurements establish why a normal update cannot remain one transaction.
The multi-transaction protocol below sets and tests a separate 256-validator
limit. Explicit two-header misbehaviour evidence still requires its own design
because its payload shape is materially larger than a normal update.

## Experimental multi-transaction update protocol

Fresh deployments use a separate Tendermint client validator that does not
accept the old single-transaction update redeemer. Existing deployments without
the session validators keep the old behavior. The staged protocol is
experimental.

A normal update has two phases. Phase one starts by minting a temporary session
NFT. Its datum commits to the header, trusted client state, validator counts,
running voting-power totals, and an RFC-6962 Merkle accumulator. For a
skipped-height update, the first group of transactions authenticates the trusted
validator set. The next group checks the target validator set and its aligned
commit signatures. Each transaction handles at most six validators. Phase-one
init and advance verification ends when its last transaction writes a Complete
session that has been confirmed and indexed.

The Gateway builds the remaining phase-one transactions as one
dependency-ordered chain. Hermes signs and submits them in order, waiting for
node acceptance of intermediate transactions and ledger confirmation of the
Complete session. Cardano may include dependent transactions in the same block,
but correctness does not depend on that. The `rebuild_after_submission` marker
then makes Hermes rebuild the original update. The Gateway reads the confirmed
Complete session and fresh client and HostState inputs, applies a normal narrow
validity window, and returns a separate final-only transaction. That transaction
burns the session NFT and updates the client and HostState atomically.

The session datum is the source of progress after a restart. The Gateway checks
live UTxOs through Ogmios, loads their datums through the indexer, resumes at the
recorded validator count, and cancels duplicate or stale sessions. Cleanup chains
use the same rebuild marker so Hermes confirms the phase boundary and retries the
original update instead of reporting success. Confirmed update events can be
reconstructed from historical session outputs and their indexed redeemers; they
do not depend on process memory.

Version 1 supports at most 256 validators. With equal trusted and target set
sizes, its deterministic transaction counts are:

| Validators | Adjacent update | Skipped-height update |
| ---------: | --------------: | --------------------: |
|         45 |              10 |                    18 |
|        100 |              19 |                    36 |
|        200 |              36 |                    70 |
|        256 |              45 |                    88 |

The hard batch limit is six. Prepared-fixture Aiken tests subtract an identical
fixture-construction baseline, because decoding the legacy 45-validator CBOR
and deriving the expected continuation are not ledger work. The marginal
six-entry adjacent step costs 11,704,438 memory and 3,943,023,573 CPU; the
45-validator skipped-height step with six trusted-membership proofs costs
14,793,854 memory and 4,772,303,193 CPU. A precomputed canonical 256-validator
root with six depth-eight proofs at bitmap indices 250 through 255 costs
38,700,147 memory and 11,520,189,768 CPU raw. Against its 23,630,558-memory and
6,544,637,059-CPU setup baseline, that is 15,069,589 memory and 4,975,552,709
CPU of marginal validator work, leaving 605,411 memory below the project's
15,675,000 safe limit. Seven depth-six proofs already cost 15,978,541 memory,
so the consensus batch limit remains six.

The paired session-init mint test costs 8,739,800 memory and 2,909,344,910 CPU
raw, against a 2,287,117-memory and 863,077,474-CPU setup baseline: a marginal
6,452,683 memory and 2,046,267,436 CPU.

Paired fixture baselines estimate the four scripts in the minimum-history final
transaction at 12,730,661 memory and 3,989,930,237 CPU in total. This is a
subtracted Aiken-test estimate, not a provider evaluation of one combined
transaction.

These are structural counts rather than live measurements. The Aiken figures
are isolated validator estimates rather than provider-completed transaction
evaluations. Staged misbehaviour evidence is also not implemented; the new
protocol currently accepts normal `Header` updates only.

## Local end-to-end benchmark

On 4 September 2026, a local run transferred 12,345 units of a Cardano native
asset to the single-validator `v8-classic` ibc-go v8.7.0 chain and then returned
the resulting ICS-20 voucher to Cardano. This was an ICS-20 round trip, not an
AMM swap. The run used `run_direct_token_swap.sh` with `COSMOS_RETURN_DENOM`
set to the minted v8 voucher. The Cardano receiver balance changed from zero to
12,345, the Cosmos voucher balance returned to its pre-run value, and both
channel commitment sets returned to their pre-run state.

| Cardano work | Transactions | Total bytes | Fees (lovelace) | Highest transaction memory | Highest transaction CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Send | 1 | 2,271 | 2,814,966 | 11,187,684 | 3,501,352,459 |
| Two Tendermint updates | 8 | 14,642 | 9,675,878 | 11,583,647 | 3,871,730,128 |
| Acknowledgement | 1 | 2,222 | 2,804,647 | 10,020,381 | 3,327,890,869 |
| Receive and unescrow | 1 | 2,419 | 3,392,220 | 15,697,994 | 5,006,318,793 |
| Total | 11 | 21,554 | 18,687,711 | - | - |

Each Tendermint update used three dependent session transactions followed by
one final client-update transaction. In both updates, Cardano included all
three session transactions in one block and the final transaction in the next
block. The full command took 566.62 seconds. Most of that time was spent waiting
for the configured 24-block Cardano stability threshold, so it is safe relay
latency rather than raw transaction-processing time.

This run proves the transaction chaining, relay, acknowledgement, and token
round trip against a real local route. Its one-validator v8 chain does not
measure validator-set scaling; the deterministic tests above cover that shape,
and a live 200- or 256-validator run remains necessary.

An initial run that sent a new Cosmos-native `utest` denomination to Cardano
also exposed an existing packet-level limit. Its first-seen voucher receive
required 22,437,146 memory units against the 16,500,000 transaction limit. That
path is separate from Tendermint update staging. Returning the Cardano-origin
voucher used the unescrow path and succeeded, although its receive transaction
used 15,697,994 memory units, or 95.1% of the limit.
