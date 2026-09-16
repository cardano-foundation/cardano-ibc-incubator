# Proof-backed consensus history

This replaces the separate archive UTxOs proposed in [PR #734](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/734). Each client output holds its latest checkpoint and a 32-byte history root. An update inserts the consumed checkpoint into that tree. Older checkpoints are supplied with Merkle proofs when needed, without creating archive outputs or locking more ADA for each retained header. This needs a fresh contract deployment, it does not upgrade existing client outputs in place. Startup requires the deployment's `proof-backed-v1` history-format marker.

The published-data and incremental-index pattern follows [Cardano MPFS](https://github.com/cardano-foundation/cardano-mpfs-onchain) and its [chain follower](https://github.com/lambdasistemi/cardano-mpfs-offchain). We retain our 64-level SHA-256 tree and Tendermint verification rather than adopting MPFS's tree format or owner-signature requirement. This change addresses history storage, not validator-set size.

## Contracts and transaction building

The spending validator still verifies Tendermint headers. The existing `recover_client` withdrawal script also checks history insertions and historical witnesses, keeping the scripts small enough to deploy. Each record authenticates its client, height, consensus state and original processing metadata. Insertion requires an absence proof. Freezing preserves the history root. Recovery retains the subject client's history and archives its previous checkpoint.

The staged Tendermint flow verifies signatures in update sessions, then consumes the completed sessions and the client together. Finalization carries at most two historical witnesses and, for a normal update, an insertion proof for the previous tip. Its `CheckStagedClientHistory` withdrawal authenticates those exact witnesses and the history-root transition; the client spend binds witness relevance to the session plans and checks the resulting client state. Misbehaviour freezes preserve the root. Session initialization, verification batches and cancellation do not use the history withdrawal. The Gateway and pinned Hermes signer use the same finalization and recovery layouts.

Packet and handshake transactions carry an older checkpoint's witness inside the proof redeemer. The consuming validator checks it against the authenticated client root before using the state or delay metadata. Latest-height operations need no historical witness. The public ICS-07 client and consensus values remain unchanged and old public consensus leaves are retained.

This history-storage change does not require changes to the Cosmos probabilistic light-client modules. Deployment requires the updated Cardano contracts, Gateway and Hermes support. The separate devnet pool-registration exception has been removed from this change; Gateway and the Cosmos modules retain the existing registration-cutoff policy.

The Gateway and shared transaction-builder runtime use the same history codecs and index. The Gateway rebuilds private witnesses from Yaci history. The standalone builder can rebuild public consensus leaves from Kupo's spent outputs and retained datums, then checks the complete result against the live HostState root.

## Recovery and operating requirements

The SQLite index is disposable. Recovery reads accepted Cardano transactions from client creation onwards and checks each predecessor and resulting root against the published outputs. It serves proofs only after reaching the independently read live client NFT output. Original processing metadata is recovered from datums, never replaced with recovery time. Public commitment bytes follow ledger `serialiseData` encoding.

Replay commits changes and rollback information together. It resumes after interruption and rewinds on forks. Cache integrity and returned witnesses are checked, missing or corrupt history stops requests. The Gateway bounds open indexes and database waits. Each deployment and client has a separate cache identity.

The public IBC tree is separate from each client's private history tree. Its in-memory state and PostgreSQL `ibc_state_tree_cache` snapshots are also rebuildable. A historical proof query with a missing or invalid snapshot reconstructs the public tree at the requested Cardano block from retained Yaci outputs and their spend history. It uses the production leaf encoders for historical consensus states, clients, connections, channels, packets and ports, and requires the computed root to match that block's HostState datum. Only verified trees are served and cached by root and HostState output reference. Historical reconstruction never replaces the live transaction-building tree and does not add a database service or volume.

For this historical fallback, retain raw `address_utxo` rows with assets and inline datums, `tx_input` spend records, and canonical `transaction`/`block` data from deployment creation. Reads use a repeatable-read, read-only snapshot and reject a changed canonical block after reconstruction. Same-block spends, later updates and failed transactions are accounted for when selecting the state at the requested height. Missing data or a root mismatch fails the request; the Gateway cannot reconstruct records from a root alone. Repeated requests share an in-progress rebuild, up to four distinct rebuilds may run concurrently, and individual SQL statements time out after 30 seconds. Cold reconstruction time and memory grow with retained public state and history.

Historical transactions must remain available from an independent source. A current UTxO snapshot or the Merkle root alone cannot recover the records. Yaci must retain spent outputs and transaction CBOR with canonical validity information. Kupo must retain spent client outputs and their datums. There is no archive pruning transaction, but disk usage, restart integrity checks and cold replay still grow with history.

## Tests and reproduction

The signed emulator tests exercise production creation, updates, freezing, recovery and use of an older state. Staged-flow tests load the same validator factory as deployment, mint each session NFT, verify real four-validator signatures in adjacent and non-adjacent batches, then consume the completed session and burn its NFT during client finalization. They also cover staged freezing with a historical witness, rejection of forged witnesses and metadata, staged recovery at 1, 100 and 10,000 retained checkpoints, and cold recovery followed by a packet-history operation. No completed session receipt is seeded. The cold-recovery test deletes the local database and public tree, rebuilds both roots from submitted transaction CBOR, then uses the recovered checkpoint in a script-checked packet-history operation. Its connection and channel setup is seeded. Block positions are simulated, this is not a live Yaci or full-network recovery benchmark.

Gateway PostgreSQL integration tests reconstruct earlier public roots from raw Yaci-shaped fixtures, including retained consensus leaves, packet pruning, same-block spends, future updates, failed/orphaned transactions, pagination and incomplete history. Proof-query tests cover cache reuse, root verification, rollback rejection and isolation from the live tree. These tests run with `BRIDGE_HISTORY_TEST_DATABASE_URL` set to an isolated PostgreSQL test database, as in CI; they do not replace live recovery validation.

Use Node 22.13 or later and Deno 2.9.6, matching CI. The pinned `@lucid-evolution/uplc` evaluator fixes equality and serialization bugs in older emulator versions. From the repository root:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny --trace-level silent
cd ../offchain
deno task test:consensus-history
deno task test:consensus-history-index
```

Tests print signed transaction measurements and enforce the pinned mainnet execution limits plus size and execution reserves. `scripts/fixtures/mainnet-protocol-parameters.json` supplies the parameters without a network request. The transaction suite uses the production validators and includes recovery with 1, 100 and 10,000 seeded historical records. The index suite covers commitments, serialization, replay, rollback, interrupted recovery and cache integrity using the production client datum. The retired combined-tree validator and recovery mode are no longer included.

Use the measurements printed by the current test run for transaction sizes, execution units and replay timings. The fixtures pin network parameters and use seeded state; they do not measure live relay throughput. Signed reference-script publication is checked separately by `deno task test:deployment` against the 16,384-byte transaction limit.

For an independent read-only rebuild, run `deno task recover:consensus-history deployment.json history.sqlite [revisionNumber revisionHeight]`. The deployment file contains `clientToken: { policyId, name }`, `stateAddress` and `bootstrap: { txHash, outputIndex }`. Set `HISTORY_DB_URL`, `KUPO_URL` and `OGMIOS_URL`. Only the production client datum is supported. Omit `layout`; existing configurations with `layout: "production"` remain valid. Experimental layout configurations are rejected, and their disposable indexes must not be reused. A retry-limit error retains progress, rerun the same command to continue. SQL queries default to a 30-second timeout through `HISTORY_DB_QUERY_TIMEOUT_MS`.

The pinned Hermes signer recognizes `proof-backed-v1` and checks the update withdrawal and new recovery redeemer against the pinned scripts and requested clients. Its tests use update and recovery transactions accepted by the emulator with Lucid's automatic input selection. Spending and collateral may share a wallet UTxO, as allowed by [CIP-40](https://cips.cardano.org/cip/CIP-0040). Hermes checks the successful transaction and collateral return separately against the same independently resolved output. Production rollout still requires long-history live measurements, a successful packet transfer after live recovery, and independent validation of a fresh deployment using the current staged update flow. Seeded emulator scale tests and the historical devnet results below do not complete those checks. The existing 64-bit tree path bound and validity-bound processing time are unchanged.

### Local devnet check, September 2026

The historical live results below used a devnet pool-registration exception that is no longer included in this branch. They are not a live validation of the branch after its removal. Reproduction must use a network compatible with the existing pool-registration policy; a fresh post-cutoff devnet does not qualify its genesis pools under that policy.

A live Cardano devnet and one-validator `v8-classic` chain completed client updates and connection and transfer-channel handshakes. Recovery of a genuinely expired client and a subsequent update passed through Hermes. The subject retained its NFT and previous records with their original processing metadata. The substitute output was unchanged. Recovery used 10.95 million memory units and 3.56 billion CPU steps. The follow-up update used 12.88 million memory units and 4.26 billion CPU steps.

Fresh Yaci and Kupo databases replayed retained blocks without the old databases. Empty private and public caches recovered identical roots and the oldest-checkpoint witness. Gateway application recovery after indexer catch-up took 3.05 seconds for three checkpoints. Killing recovery after two durable checkpoints and restarting took 2.09 seconds. Missing accepted CBOR stopped startup and witness access. A natural epoch-boundary rollback also exposed a missing Yaci nonce, a separate fresh replay restored contiguous nonce evidence checked against the node.

A dedicated client then reached 100 retained checkpoints. Both samples had a 340-byte datum, exactly 2.62048 ADA locked in one client output and a 9,477-byte update transaction. No archive outputs were created. Size is reconstructed from accepted block components. Execution units below are accepted redeemer budgets, also checked against node evaluation.

| Retained checkpoints, including tip | Memory units | CPU steps | Cold private-index replay | Closed index size |
| --- | ---: | ---: | ---: | ---: |
| 10 | 12,871,989 | 4,262,709,117 | 115 ms | 147,456 bytes |
| 100 | 12,876,092 | 4,266,074,038 | 723 ms | 1,060,864 bytes |

Both replays matched the live root and regenerated the oldest witness. These growth runs used a local Gateway component driver and a height step of two. They exclude Hermes signing-policy checks and finality waits. Replay timings exclude indexer catch-up. They are not relay-throughput or large-validator-set benchmarks.

The host was an Apple M5 with 16 GiB RAM, with four CPUs and about 8 GiB assigned to Colima. Node `11.1.1` prerelease ran protocol version `11` with mainnet execution limits, fees and cost models. Ogmios `7.0.0` required a local representation-only adapter for newer reference-script builtins. Hermes required [PR #23](https://github.com/cardano-foundation/hermes-relayer/pull/23). Adjacent updates remain blocked in Gateway preflight. The token roundtrip failed before signing because the packet sender was a full address instead of the required payment-key hash. No tokens moved.

See `--help` in [`consensus-history-live.ts`](../gateway/src/scripts/test/consensus-history-live.ts) for isolated-cache recovery and [`measure-live-consensus-history.ts`](../offchain/scripts/measure-live-consensus-history.ts) for growth measurements. Recovery is read-only by default. Growth submits real updates. Recovery's optional `--prune` submits a packet-pruning transaction, not a token transfer.
