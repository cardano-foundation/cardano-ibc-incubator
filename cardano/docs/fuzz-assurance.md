# Fuzz assurance and replay

The suite separates fixed regressions, generated handler tests, and compiled
transaction histories. Counts and labels describe execution, not a guarantee
that the protocol is safe to hold funds.

## Aiken properties and CI

The 94 properties that discarded their generated seed are ordinary unit
regressions now. They still run in the complete smoke pass. The property
inventory rejects discarded/unused generated bindings and discovers every
remaining property for a 500-case deep shard, including the two HostState
properties formerly omitted from the hand-maintained matrix. The check is
syntactic: using a binding does not by itself demonstrate meaningful variation.

The aggregate compares the actual smoke property identities with the deep
reports, rejects duplicates/failures, and requires at least 100 successful
iterations per property. Required labels only attest scenario execution.
Distribution rules divide bucket counts by the iterations of their named
property, so unrelated properties cannot dilute an existing bucket.

Eight transfer properties vary packet amounts from 1–100 and 1,000,000–
1,000,000,000,000, escrow balances and one-unit violations. Three capacity
properties vary the split between receipts and acknowledgements at the actual
history limit. Each side of these generators must occupy at least 20% of its
property's cases. These buckets measure those particular dimensions only.

The stable **Cardano Onchain Aiken** aggregate requires `deno-offchain` and all three `deno-funds` shards, and
requires the critical-guard mutation job whenever deep fuzzing runs. Failed
Aiken shards preserve JSON reports and stderr; compiled funds runs preserve
fast-check output, including seeds, shrink paths and counterexamples.

```sh
node --test scripts/ci/aiken-property-inventory.test.mjs scripts/ci/check-aiken-fuzz-coverage.test.mjs scripts/ci/detect-aiken-semantic-changes.test.mjs
node scripts/ci/aiken-property-inventory.mjs
cd cardano/onchain
aiken check --deny --max-success 500 --seed 674 --exact-match -m prop_funds_native_send_amount
```

Repository merge rules are separate from these workflow dependencies. To enforce
this CI policy, require both `Cardano Onchain Aiken` and `Docs Branch Guard` in
branch protection. The `docs/` branch exception relies on the latter check to
reject non-documentation changes. A workflow definition alone does not establish
that either check is required.

## Compiled funds histories

`cardano/offchain/src/funds-lifecycle.fuzz.test.ts` generates ADA, native-token
and voucher cases. Transactions execute all their compiled Mint/Spend witnesses
with local UPLC evaluation before submission to the emulator. A valid generated
baseline is evaluated before malformed variants; ordinary builder errors do
not count as script rejection. Each funds evaluation uses a fresh worker running
the same UPLC engine, cost models and limits as Lucid's local evaluator. Repeated
rejected evaluations in one runtime triggered a WASM trap during deeper histories.
The isolated provider returns measured execution costs, never the emulator's
placeholder budgets. A compiled comparison test checks every returned redeemer
against local evaluation. Runtime traps still fail the test.

Native histories vary amounts, reserves, packet data, sender/recipient keys,
unrelated assets, command order and which outstanding packet is settled. They
hold multiple packets concurrently, use successful acknowledgement, error
acknowledgement and timeout, then receive returning funds. Repeated receives
and terminal operations are rebuilt against current ledger state, testing
protocol replay handling rather than merely spending an old UTxO twice.

Voucher histories execute the real voucher policy: receive/mint, send/burn,
successful acknowledgement, and remint on error/timeout. An independent model
checks voucher supply across every unspent emulator output and exact balances
at the signing wallet and two generated destinations, one key address and one
script address. Vouchers move to those destinations before burns and refunds.
Packet commitments are recomputed from the sent packets using a separate
ICS-04 encoding implementation. Receipts and acknowledgement values are checked
as well as their sequence keys after each protocol submission.
The native model checks exact escrow principal and reserves, exact native-token
refunds, and preservation of module state, registry root, HostState assets and
channel ADA. Sequence counters, receipt/acknowledgement inventories and protected
HostState/channel fields are checked against the model as well. Voucher metadata and unrelated native escrow remain unchanged.
ADA recipient outputs must deliver at least the refunded principal and may
include additional minimum ADA; exact escrow principal is checked separately. The current native receive guard permits
wallet-funded excess payments, so excess receive payments are not asserted to
fail.

Mutations include short/excess escrow, burns and refunds, wrong callback data,
wrong proof roots and wrong refund recipients. Malformed variants are never
submitted. Counterparty consensus references are reset after proof mutations.

The harness supplies authenticated counterparty consensus references instead
of executing Tendermint updates. It seeds previously registered CIP-68 voucher
metadata, uses one unordered channel, and bounds each history. It does not yet
randomize first-seen trace registration, registry rollover, ordered funds
channels or cross-channel interactions. Existing handler regressions for those
areas remain useful, but are not equivalent to compiled history coverage.

CI runs five histories per asset family in separate shards; the local default is
twenty. Seeds and original cases are logged before evaluation so interrupted
shrinking also leaves a reproducible input. The original error is printed before
shrinking starts.

The separate `Funds Fuzz Campaign` workflow runs nightly on the default branch
and supports manual dispatch. It runs 60 histories across six independent shards
with fresh seeds. Its `deep` profile generates 12–24 random commands rather than
1–6 and gives voucher histories 12–24 outgoing packets rather than 3–5. Forced
terminal operations, draining pending packets, receives and negative cases add
transactions beyond those command counts. Each shard has a three-hour timeout.
Logs include the commit, profile, seed, cases and operation progress and are
uploaded on failure too, with 90-day retention. This is a randomized campaign,
not execution-coverage-guided exploration. It does not maintain a coverage corpus.

Replay needs the same commit and profile as the failing run. Build the
blueprint and use the normal repository dependency setup before running:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
cd ../offchain
TX_FUZZ_RUNS=5 TX_FUZZ_SEED=674 deno task test:funds:fuzz
# Run the deeper profile locally:
FUNDS_FUZZ_PROFILE=deep TX_FUZZ_RUNS=10 deno task test:funds:fuzz
# Replay with the original profile and fast-check's reported seed and shrink path:
FUNDS_FUZZ_PROFILE=pr TX_FUZZ_RUNS=5 TX_FUZZ_SEED=674 TX_FUZZ_PATH='0:1:2' deno test --allow-env --allow-read --filter 'compiled native token' src/funds-lifecycle.fuzz.test.ts
```

## Critical guard mutations

```sh
# From the repository root, after fetching Aiken dependencies:
node scripts/ci/check-aiken-mutations.mjs /tmp/aiken-mutations.json
```

The runner copies the onchain project to a temporary directory. For each of
four independent mutants it first verifies the selected tests on unchanged
source, then weakens one guard: receipt replay, native-send amount, native
refund amount, or callback commitment binding. The expected rejection tests
must fail on the mutant. Compilation failures, timeouts and missing tests are
runner failures, never successful kills. Production sources are untouched.
Reports include the seed, original source hash and failing test names, alongside
baseline/mutant JSON and stderr. This checks detection capability for these
four protections; it is not a comprehensive mutation analysis.
