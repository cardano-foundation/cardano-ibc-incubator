# Proof-backed consensus history

This replaces the separate archive UTxOs proposed in [PR #734](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/734). Each client output holds its latest checkpoint and a 32-byte history root. An update inserts the consumed checkpoint into that tree. Older checkpoints are supplied with Merkle proofs when needed, without creating archive outputs or locking more ADA for each retained header. This needs a fresh contract deployment, it does not upgrade existing client outputs in place. Startup requires the deployment's `proof-backed-v1` history-format marker.

The published-data and incremental-index pattern follows [Cardano MPFS](https://github.com/cardano-foundation/cardano-mpfs-onchain) and its [chain follower](https://github.com/lambdasistemi/cardano-mpfs-offchain). We retain our 64-level SHA-256 tree and Tendermint verification rather than adopting MPFS's tree format or owner-signature requirement. This change addresses history storage, not validator-set size.

## Contracts and transaction building

The spending validator still verifies Tendermint headers. The existing `recover_client` withdrawal script also checks history insertions and historical witnesses, keeping the scripts small enough to deploy. Each record authenticates its client, height, consensus state and original processing metadata. Insertion requires an absence proof. Freezing preserves the history root. Recovery retains the subject client's history and archives its previous checkpoint.

Packet and handshake transactions carry an older checkpoint's witness inside the proof redeemer. The consuming validator checks it against the authenticated client root before using the state or delay metadata. Latest-height operations need no historical witness. The public ICS-07 client and consensus values remain unchanged and old public consensus leaves are retained.

The Gateway and shared transaction-builder runtime use the same history codecs and index. The Gateway rebuilds private witnesses from Yaci history. The standalone builder can rebuild public consensus leaves from Kupo's spent outputs and retained datums, then checks the complete result against the live HostState root.

## Recovery and operating requirements

The SQLite index is disposable. Recovery reads accepted Cardano transactions from client creation onwards and checks each predecessor and resulting root against the published outputs. It serves proofs only after reaching the independently read live client NFT output. Original processing metadata is recovered from datums, never replaced with recovery time. Public commitment bytes follow ledger `serialiseData` encoding.

Replay commits changes and rollback information together. It resumes after interruption and rewinds on forks. Cache integrity and returned witnesses are checked, missing or corrupt history stops requests. The Gateway bounds open indexes and database waits. Each deployment and client has a separate cache identity.

Historical transactions must remain available from an independent source. A current UTxO snapshot or the Merkle root alone cannot recover the records. Yaci must retain spent outputs and transaction CBOR with canonical validity information. Kupo must retain spent client outputs and their datums. There is no archive pruning transaction, but disk usage, restart integrity checks and cold replay still grow with history.

## Tests and reproduction

The signed emulator tests exercise production creation, updates, freezing, recovery and use of an older state. The cold-recovery test deletes the local database and public tree, rebuilds both roots from submitted transaction CBOR, then uses the recovered checkpoint in a script-checked packet-history operation. Its connection and channel setup is seeded. Block positions are simulated, this is not a live Yaci or full-network recovery benchmark.

Use Node 22.13 or later and Deno 2.7 or later. The pinned `@lucid-evolution/uplc` evaluator fixes equality and serialization bugs in older emulator versions. From the repository root:

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
aiken check --deny --trace-level silent
cd ../offchain
deno task test:consensus-history
deno task test:consensus-history-prototype
```

Tests print signed transaction measurements and enforce the pinned mainnet execution limits plus size and execution reserves. `scripts/fixtures/mainnet-protocol-parameters.json` supplies the parameters without a network request. The earlier prototype's measurements are not production packet-transfer measurements.

With the corrected evaluator, the four-validator update used 9,428 bytes and 13.87 million memory units. Recovery used 8,078–8,086 bytes and 10.72–10.74 million memory units. The packet operation using a checkpoint recovered after deleting the database used 8,795 bytes, 11.30 million memory units and 3.57 billion CPU steps. Replaying the two fixture transactions took 7–10 milliseconds, not counting any real network scan. Reference-script deployment checks are size models, not signed publication transactions.

For an independent read-only rebuild, run `deno task recover:consensus-history deployment.json history.sqlite [revisionNumber revisionHeight]`. The deployment file contains `clientToken: { policyId, name }`, `stateAddress` and `bootstrap: { txHash, outputIndex }`. Set `HISTORY_DB_URL`, `KUPO_URL` and `OGMIOS_URL`. Production layout is the default. A retry-limit error retains progress, rerun the same command to continue. SQL queries default to a 30-second timeout through `HISTORY_DB_QUERY_TIMEOUT_MS`.

The pinned Hermes signer recognizes `proof-backed-v1` and checks the update withdrawal and new recovery redeemer against the pinned scripts and requested clients. Its tests use update and recovery transactions accepted by the emulator with Lucid's automatic input selection. Spending and collateral may share a wallet UTxO, as allowed by [CIP-40](https://cips.cardano.org/cip/CIP-0040). Hermes checks the successful transaction and collateral return separately against the same independently resolved output. Live Yaci recovery, a long-history recovery-time measurement and independent deployment testing remain required before production use. The existing 64-bit tree path bound and validity-bound processing time are unchanged.
