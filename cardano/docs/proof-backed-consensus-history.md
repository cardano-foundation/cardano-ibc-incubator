# Proof-backed consensus history prototype

This experiment is based on [PR #734](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/734). It keeps the latest checkpoint and a 32-byte root on-chain. Older records arrive with Merkle proofs instead of occupying archive UTxOs. It follows [Aiken's registry guidance](https://aiken-lang.org/optimizing-programs#use-merkle-patricia-forestry-for-larger-registries) using our existing 64-level SHA-256 tree.

## What is tested

Internal leaves authenticate the client, both height components, consensus state and processing metadata. The archived record comes from the authenticated input. An absence proof prevents overwrites. Public consensus leaves are retained unchanged alongside the internal records.

The emulator seeds a unique NFT and trusted checkpoint. A prototype validator combines the client and root in one output. It verifies a signed four-validator update and archives the previous checkpoint in the tree. Another transaction reads that checkpoint and checks delay metadata. Tests reject tampering, stale proofs, expiry, insufficient delay and invalid signatures.

Records are synthetic occupancy, not replayed headers. Lookups use one client's sequential history. Updates use the fixed signed height `2 -> 3` fixture and fill the tree with other clients' records. Historical-trust updates change only the IBC wrapper's trusted height.

## Measurements

Signed emulator transactions on an Apple M5 with 16 GB RAM, using Aiken `1.1.21` with traces disabled and pinned mainnet epoch `654` parameters. Limits are `16,384` bytes, `16,500,000` memory units and `10,000,000,000` CPU steps. Tests require an additional 750-byte size reserve and 5% execution reserve.

| Historical records | Lookup bytes | Update bytes | Lookup memory | Update memory |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2,862 | 11,207 | 2,135,186 | 13,731,354 |
| 100 | 2,862 | 11,207 | 2,132,780 | 13,732,342 |
| 10,000 | 2,862 | 11,207 | 2,131,978 | 13,733,145 |

Updates above use a historical trusted height. At 10,000 records lookup/update CPU costs are `697,027,823` / `4,644,317,971` steps and fees are approximately `0.750` / `2.366 ADA`, including the shared reference script. An adjacent update uses `8,857` bytes and `11,326,950` memory units. These are complete prototype transactions, not production packet transfers.

There are no history outputs. The prototype state needs `2.33–2.37 ADA`, with the small difference caused by height encoding. The representative separate-archive minimum multiplied by 10,000 is approximately `18,921 ADA`. These exclude fixed deployment deposits. Each witness carries 2,048 raw sibling-hash bytes before encoding and the record.

Off-chain work still grows: 10,000 records take roughly 11 seconds to index and another 33 seconds to prepare update witnesses because each changed leaf triggers a rebuild. Frequent updates need an incremental, persistent index.

## Reproduce

From the repository root:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny --trace-level silent -m 'consensus_history_commitment.{..}'
cd ../offchain
deno task test:consensus-history-prototype
```

Tests print JSON measurements and run in CI. `scripts/fixtures/mainnet-protocol-parameters.json` pins limits, prices and the Plutus V3 cost model without network calls.

## Before production integration

All 62 existing blueprint entries compile identically to the parent. Deployment and Gateway behavior are unchanged. Remaining work includes real HostState/client integration, packets, creation, recovery, freezing and pruning. Backfill needs authenticated neighbour/absence checks. The existing 64-bit path limitation and validity-bound processing time are unchanged.

The helper validates record-only snapshots against an independently supplied root. Combined-tree replay, rollback handling and replicated history remain unimplemented. Missing records must stall requests. This addresses history storage, not large validator sets.
