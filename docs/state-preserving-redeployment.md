# State-preserving bridge redeployment

This implements compatible contract replacement for [issue #462](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/462): new contracts, the same bridge, existing vouchers and outstanding claims. It requires a fresh `cardano-ibc-compatible-v3` deployment with migration enabled. Production release remains blocked on the qualifications below.

## Mechanism and compatibility

The bridge separates permanent identity from replaceable spending contracts. An authenticated registry governs the active implementation. HostState, client, connection, channel and transfer/escrow spending contracts can change. Original voucher policies and asset names, state tokens, port/module identities, routes, state formats and proof encodings remain fixed. Supporting packet, proof, session, recovery, trace and metadata scripts retain their original applied bytes. Unsupported changes fail closed.

Governance approves the complete successor configuration, exact addresses including staking credentials, source generation, nonce and compatibility constraints. Approval has an on-chain delay of at least 24 hours. Executors can carry out an approved handover without governance keys, but cannot choose its contracts. Ordinary HostState or transfer-root UTxO turnover does not invalidate the reviewed intent. Authorization resolves their current authenticated tokens, and migration start independently checks the approved inventory and count limits. Incompatible changes require a new review.

Approval freezes creation of core objects and escrow shards while otherwise permitted existing-object activity continues. Beginning migration moves HostState and pauses ordinary state transitions, including packet settlement and final client updates. Independent session work and historical proof reads remain available. Each subsequent transaction moves one authenticated object or escrow shard while updating the registry. Moves preserve datums, reference scripts, non-ADA assets and at least the original ADA. A separate executor funds fees and additional deposits. Migration does not mint replacement vouchers or reset settlement history.

Sequential counters account for every client, connection and channel. A committed escrow inventory removes each remaining entry only when its actual shard moves. Activation requires complete counters and an empty remaining inventory. It verifies the exact transfer-application registration and corresponding commitment update. Other committed content and pending refund/remint obligations remain intact. Shutdown and retirement are disabled so cleanup cannot bypass this accounting.

The supported counterparty is the repository's ibc-go v8 classic ICS-20 chain with its stake-weighted probabilistic Cardano client. It recognizes the unchanged HostState identity and proof format. Gateway and Hermes follow authenticated address history and retain historical proofs. Mithril migration and generic channel upgrades are unsupported. The same mechanism supports subsequent successors.

Unlike an EVM proxy switch, custody moves between actual spending addresses over multiple transactions. Ordinary traffic pauses during handover. Cancellation is available before migration begins, but there is no general undo afterward. The counterparty continues running, so packets can time out and clients can expire. Governance remains trusted to approve safe code. Preserving assets during migration cannot prevent a malicious successor from stealing later, and faults in immutable policies or the migration mechanism may be unrecoverable.

## Emergency containment

A separately configured emergency quorum can restrict operations before a proposal, during its delay or during migration. `restrict --mask 9` stops packet traffic, settlement, pruning and topology changes and holds migration execution and activation. Mask `15` also stops client maintenance and heartbeat. Mask `1` leaves an approved handover available while traffic remains restricted. Client maintenance and heartbeat remain available under mask `9` outside the migration phase. Read-only proofs remain available.

Containment takes effect on canonical inclusion and is enforced against direct transaction submitters. It cannot undo earlier exploitation or prevent a rollback from removing the restriction. Emergency keys can only tighten restrictions. Permission restoration requires `propose-restoration` with governance signatures followed by `restore` after the unchanged delay. A new restriction revokes a pending permission restoration. Governance can separately use delayed `rotate-emergency` to replace compromised emergency keys while preserving the hold. Repeated restrictions cannot veto that authority-only replacement.

## Operator procedure

Select `IBC_DEPLOYMENT_MODE=upgradeable` and supply a valid `MIGRATION_GOVERNANCE_FILE` before deploying. Configuration needs explicit signer hashes, quorum, delay and a disjoint emergency signer set. Missing or contradictory configuration fails before deployment. Intentional immutable deployment requires explicit `legacy` selection. Readiness checks authenticate deployed registry/state identities and current addresses rather than trusting a manifest label.

Retain the original handler, applied policies, full canonical history and reviewed successor blueprint. Use Aiken `1.1.21` and Deno `2.9.6` with locked dependencies. Set `KUPO_URL`, `OGMIOS_URL` and `CARDANO_NETWORK_MAGIC` explicitly. The migration CLI does not load `.env.default`. Submission uses the explicitly supplied `MIGRATION_EXECUTOR_SK`. Ensure the counterparty can catch up and its trust window accommodates the pause. Fund the executor separately for fees, collateral and deposits.

From `cardano/offchain`, inspect and prepare the reviewed plan:

```sh
deno task migrate:deployment inspect --handler /artifacts/handler-v1.json
deno task migrate:deployment prepare --handler /artifacts/handler-v1.json \
  --blueprint /artifacts/reviewed-v2/plutus.json --out /artifacts/migration-v2.json
```

Retain the reported plan digest. `publish` uses `--handler`, `--plan`, `--outbox` and `--submit` to publish references with the explicitly configured executor. `authorize` uses `--handler`, `--plan`, `--signers`, `--expires-at`, `--wallet-address` and `--out` to export an unsigned approval for the normal quorum-signing workflow. Expiry is a POSIX millisecond timestamp beyond the approval delay and intended start. A stale approval transaction needs rebuilding and fresh signatures over its exact body.

After approval matures, execute bounded steps:

```sh
deno task migrate:deployment execute --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --outbox /artifacts/v2-outbox \
  --max-steps 20 --submit
```

Use `resume` with the same arguments after interruption. Every step reads canonical registry state, waits for provider inclusion and verifies output adoption. This does not establish irreversible finality or pipeline unconfirmed transactions. The disposable inventory cache verifies its root against the registry and rebuilds after unexpected progress, restart or rollback. Stale or incomplete inventory stops execution. Preserve the outbox and signed revisions, and inspect canonical state before retrying an unresolved submission.

Before activation, use Gateway's `export:migration-witness` command with the original handler and an output path. It reconstructs and authenticates the transfer-port proof from retained history. Supply that path through `--port-witness` when resuming. After activation, `verify --handler ... --plan ... --out ...` produces the successor handler. Export Gateway's normalized bridge manifest, update Gateway and Hermes' pinned manifest, then restart them. Recheck historical proofs, old redemption/refund/remint and new traffic on the existing routes. Retain original addresses and history. Repeat from the verified successor handler for the next migration.

## Executed evidence

The identifiers here are the original execution revisions. Later commit-message cleanup preserved their file trees. Detailed outputs remain in CI artifacts and Git history instead of separate reports in this PR.

At `79dc91f53`, the [populated rehearsal passed](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35287600121/job/105423347310) on five Cardano producers and a real Cosmos counterparty. Two users, two channels and two escrow shards underwent V1→V2→V3 with genuinely different spending hashes. Existing vouchers worked in both directions, original escrow remained backing, and old receive, acknowledgement, timeout and refund obligations settled. A burned-voucher return reminted its original asset after timeout. New traffic worked afterward.

That run also resumed an interrupted handover and recovered after a real migration transaction was discarded from a minority fork. Final verification rechecked 37 packet receipts and 18 custody transactions. Its [artifact](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35287600121/artifacts/10529747775) retains scripts, snapshots and receipts. The workflow failed formatting only. The byte-identical formatting revision `41dfd0c5e` [passed checks-only CI](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35288005940).

Later contract optimizations at `e46111cfe` passed 1,576 Aiken smoke tests, a 261-test broader selection with 27 properties at 1,000 iterations, and 12 guard-removal controls. Compiled tests exercised authorization, containment and restoration, ordinary UTxO turnover, conservation attacks, partial migration and repeated successors. Separate economic models and generated populations broadened coverage, but seeded state and model histories are not two-chain settlement evidence. Its [fresh CI](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35342732725) failed during population, so current contract artifacts still lack that complete network acceptance.

The evaluator replacement at `0cf9919df` rebuilt both WASM targets against unmodified `uplc 1.1.23` and reproduced their recorded hashes. Local suites passed: consensus history 15 tests with one optional export disabled, history indexing 63, deployment 35, packet budgets 11, migration 29 and funds oracles four. All 15 migration-step measurements matched the previous evaluator exactly. Regressions reproduced the older published evaluator's extended-cost-table failure and verified explicit protocol-10 selection. [Evaluator provenance and hashes](../cardano/vendor/uplc/README.md) document the retained packaging override. This build has no fresh populated two-chain acceptance or protocol-11 bridge qualification.

## Scale, reproduction and release limits

For `C` clients, `L` connections, `H` channels and `N` escrow shards, custody handover requires `C + L + H + N + 3` serialized transactions. Approval and reference publication are additional. The successful devnet took 718 seconds for V2 including rollback and 178 seconds for V3 including interruption, with nine custody transactions each. Governance delay and operational restart are additional. The executor checks provider adoption, not a configured finality depth.

The local emulator completed 512 shards across eight channels in 523 transactions and 23.900 seconds. This measures execution speed, not network recovery time. The cache avoids repeatedly rebuilding the escrow inventory but cannot remove transaction serialization. Measured individual migration steps fit ledger limits. Production-scale downtime, larger real populations and worst-case receive-budget headroom remain unqualified. Existing linked-package dependency conflicts also remain a packaging qualification. The bounded static reviews were not an independent audit.

Run `deno task test:deployment`, `test:migration`, `test:tx-budgets`, `test:consensus-history`, `test:consensus-history-index` and `test:funds:oracles` from `cardano/offchain`. Build distinct successors with [build-migration-successor.py](../scripts/ci/aiken-contract-migration/build-migration-successor.py) and supply `MIGRATION_SUCCESSOR_V2_BLUEPRINT` and `MIGRATION_SUCCESSOR_V3_BLUEPRINT` for repeated deployment tests. The [main CI](../.github/workflows/ci.yml) integrates compiled tests, properties, guard controls and measurements. Dispatch it with `populated_migration=true` for the [five-node/two-chain rehearsal](../.github/workflows/migration-rehearsal.yml). Its fixture keys and clock controls are only for disposable local networks. No mainnet deployment, live authority changes or real user funds were used for these results.
