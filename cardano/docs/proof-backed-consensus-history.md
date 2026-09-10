# Proof-backed consensus history prototype

This experiment is based on [PR #734](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/734). It keeps the latest checkpoint and a 32-byte root on-chain. Older records arrive with Merkle proofs instead of occupying archive UTxOs. Recovery follows the published-data and incremental-index pattern in [Cardano MPFS](https://github.com/cardano-foundation/cardano-mpfs-onchain) and its [chain follower](https://github.com/lambdasistemi/cardano-mpfs-offchain). We keep our existing 64-level SHA-256 commitment format and Tendermint verification, not MPFS's owner-signature requirement or its different tree format.

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

The incremental SQLite tree updates only the changed leaf and its 64 ancestors. At 10,000 records the combined benchmark tree took about 8–10 seconds to build and update-witness preparation took about 3 milliseconds, down from roughly 33 seconds with repeated full rebuilds. Transaction sizes and execution budgets were unchanged. This is local witness construction, not transaction confirmation latency.

## Recovery from transaction history

A separate test submits initialization and a signed update with no pre-seeded history. It deletes all local index files and rebuilds both public leaves and full historical records from the accepted transaction CBOR. The recovered older checkpoint is then used in another script-checked transaction. Rebuilding these two state transactions took about 5 milliseconds. This small correctness fixture does not measure a real network's historical scan. Its block positions simulate a chain source, the emulator does not retain block history. The initial NFT is still a trusted emulator seed, not a production creation policy.

The index checks every predecessor and resulting root against transaction outputs. Processing metadata comes from the consumed datum, never recovery time. Public Data encodings are preserved using a serialization adapter checked against Aiken's evaluator. Each transaction's tree changes and rollback record commit together. Recovery resumes at that checkpoint and catches up if the client advances. Saved progress cannot serve proofs until replay completes and matches the independently read live NFT output. Forks rewind to a common checkpoint, with bounded retries that preserve progress.

Cache integrity is checked on opening and after another SQLite connection writes. Every returned witness is also verified against the published root. Corruption stops proof serving, recover into a fresh database from chain history instead. Tests cover interrupted cold replay, ongoing updates, same-block replacement forks and damaged leaves or nodes. The database is disposable, but some independently retained source of historical transactions remains necessary. Restart integrity checks and cold recovery still grow with retained history, warm recovery reads only the saved checkpoint and newer transactions.

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

For a deployed **prototype**, `deno task recover:consensus-history deployment.json history.sqlite [revisionNumber revisionHeight]` reads raw Yaci Store history and optionally prints an older record with its proof. `deployment.json` contains `clientToken: { policyId, name }`, `stateAddress` and `bootstrap: { txHash, outputIndex }`. Set `HISTORY_DB_URL`, `KUPO_URL` and `OGMIOS_URL`. Yaci must retain spent output rows and full transaction CBOR from initialization. Missing history fails recovery. A retry-limit error retains progress, rerun the same command to continue. SQL queries default to a 30-second timeout, configurable with `HISTORY_DB_QUERY_TIMEOUT_MS`. The adapter has unit tests, but has not yet been exercised against a live Yaci deployment. The command does not submit transactions or activate Gateway integration.

## Before production integration

All 62 existing blueprint entries compile identically to the parent. Deployment and Gateway behavior are unchanged. Remaining work includes real HostState/client integration, packets, creation, recovery, freezing and pruning. Backfill needs authenticated neighbour/absence checks. The existing 64-bit path limitation and validity-bound processing time are unchanged.

Combined-tree replay and rollback are implemented for the prototype's single-client output. Production recovery must additionally cover every shared HostState mutation, including connections, channels and packets, then replace archive reads in the Gateway. Historical retention, full-chain recovery time and migration still need testing. Missing records must stall requests. This addresses history storage, not large validator sets.
