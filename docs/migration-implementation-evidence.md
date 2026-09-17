# Migration implementation evidence

The populated local V1→V2→V3 rehearsal **passed**, including all old claims, new traffic and final canonical revalidation. The fresh CI rehearsal remains in progress; this is not a production-release or audit claim. No mainnet deployment, live authority change, or real user funds are involved. See the [requirement mapping](migration-requirements.md), [design](state-preserving-redeployment.md), and [operator runbook](migration-operator-runbook.md).

## Source and compatibility boundary

Starting main commit: `fde2635138f60f6d14954b2f91e4a001b74c12a2`. Work is isolated on `feat/462-state-preserving-redeployment`; the original dirty `feat/host-state-full-key-trie` worktree is untouched. The relayer submodule is pinned to `b35730db` on its corresponding feature branch.

This evidence concerns a **fresh upgrade-capable baseline** and its successors. It does not demonstrate recovery of any original immutable deployment. Retained policies, asset names, HostState identity, channels and the original counterparty client stay fixed. The supported counterparty is the actual ibc-go v8 classic ICS-20 stack with the probabilistic Cardano client. Migration plus Mithril, arbitrary state/schema changes, ordinary mixed-version packet service and terminal retirement are unsupported and rejected.

| Compiled fixture | Blueprint SHA-256 |
| --- | --- |
| Fresh baseline | `100d902fc6f3c401bb0004133c2c78a8de54e9a84b4c82b07b56bfc30bec9807` |
| V2, ten-minute normal-operation validity window | `336aa5b0b5d5f4a8b4f1fa9d54553ab5c994b82c6e33260e2faeb62dcbc2016b` |
| V3, fifteen-minute normal-operation validity window | `59e9fe42a82a18141a8a902ee605a39624494b7f77ea6ec072e50e3f7a1851ac` |

Each successor replaces all five spending-script hashes, including channel and escrow spending. Both reject a broad heartbeat validity interval accepted by V1. They are test releases demonstrating real replacement, not recommended production governance choices. Earlier immutable fixtures and the incompatible five-minute V3 candidate remain separately retained; none was overwritten to claim compatibility.

## Populated two-chain execution

The current evidence directory is `.deployment-smoke/long-epoch-baseline-v1-recovered`; its owned runtime is `cardano-deployment-test-6793e47ccb69-av3fh5se`. Genesis SHA-256 is `4b385e593a5ce964136481e0df51338ff66ad65fd5be309cbe40ee659becb83d`. Five real producers, five-day epochs and unchanged protocol-10 limits are used. Process-local clock advancement retains the full on-chain 24-hour approval delay and checks every producer against canonical history; host time and validation rules are unchanged.

The bridge has eight authenticated objects, two escrow shards, two channels and two holders. Thirteen real population operations establish Cardano-native escrow against remote vouchers, existing Cardano foreign vouchers, and pending receives, acknowledgements, timeout/refund and burned-return remint. Both migrations use the same `connection-0`, `channel-0/1`, `07-tendermint-0` and original Cosmos client `08-cardano-probabilistic-0`. The original voucher policy is `cf0321bfec37397dda2615e20eded450510409e0d7092b69a52bdba3`.

| Evidence | Actual result |
| --- | --- |
| V1→V2 | Activated at Cardano block 1633, transaction `df313e501ac155ae1e5fd12a1f2ef3595759ba67f2f4be205d4d389ff8b86b02`. Eight-object/holder conservation and exact port-root transition passed. |
| V2→V3 | Activated at Cardano block 3040, transaction `56c2ced08507383803b2c41b9f0db8ba5c921d99a1dd6b2b466b36c8a5948549`. The same eight-object/holder checks passed using the same mechanism. |
| Interruption and mixed custody | Each handover exits after Begin, serves accepted historical proofs from a Gateway with a fresh empty cache, rejects ordinary builders/current queries while Moving, and resumes in another process. |
| Holder independence | All eighteen custody transactions are signed only by a separate ADA-only executor and mint/burn nothing. Governance and reference publication are separate; the public approval fixture also serves as one holder and is not counted as holder-independent custody evidence. |
| Original burned voucher remint | `00761c11c6ce4f9cd1bac4fdf0cbec0ef5f7fb48d59929cd029f9a16974638e6` reminted exactly 100,000 of the original policy/name after timeout. Canonical mint map and original recipient balance verified. |
| Original native escrow redemption | `cf2af96a2f65d7ddbb75466726c8501da6d1be6220b868bed332df63bc6feea0` paid the queued 2,000-unit return from original escrow; native timeout refund `e2eceb6dae38539088b0c71de075a98e82299d31c3dba58f020a38507852c9c1` also passed. |
| Post-V2 counterparty continuity | Cosmos transaction `F2C15EC092BD6EA931ECD8866E0468DC2CDBA85A2E5076F0BD661097BC62C697`, height 1142, acknowledged an original packet using Cardano proof height 1744, after activation at 1633. |
| Post-V3 counterparty continuity | Cosmos transaction `1CE35A7CD69E1C1CB117925E8B221F7ACB7D3CB7478B2211D25418687F549E32`, height 2460, acknowledged another original packet using Cardano proof height 3385, after activation at 3040. Actual `MsgAcknowledgement` and CometBFT data commitments are checked. |
| Settlement | All thirteen V2 settlement steps passed, including new native and original-voucher return traffic. All eleven V3 settlement steps passed, including the five carried acknowledgements and new traffic in both directions. Final canonical revalidation passed for all 37 packet receipts and all 18 custody transactions. |

The [recorded result and 74 evidence checksums](evidence/migration-462-local-result.json) retain the final driver result and accounting reports. Final native backing is 8,333 A / 8,344 B; the original primary and secondary foreign voucher balances and remote backing are 1,118,456 / 500,777. The successful resumed driver ran `--from-stage settle-v3 --retry-read-failure native-pending-ack` and continued through `verify-all`; it reused and revalidated prior canonical receipts rather than redeploying either bridge.

Receipts bind exact canonical packet payloads, operation redeemers, route identities, source commitments and full block body/witness authentication. Success logs alone are insufficient. The independent fixed-flow oracle checks holder balances, native backing and both Cosmos escrow accounts. Failed attempts, canonical receipt reconciliation and explicit read-only retries remain in separate logs.

## Fees and feasibility

Values are lovelace unless labeled otherwise. Custody figures are independently recomputed from the canonical registry input/output chain, full credentials, every object's principal/deposit and external-payer balance.

| Cost / bound | V1→V2 | V2→V3 |
| --- | ---: | ---: |
| Custody transactions | 9 | 9 |
| Custody fees | 11,320,132 | 11,361,780 |
| Added custody deposits | 676,670 | 0 |
| External executor debit | 11,996,802 | 11,361,780 |
| Approval fees | 644,371 | 659,331 |
| Added approval registry deposit | 1,344,720 | 0 |
| Publication/funding fees (10 transactions) | 7,294,626 | 7,333,830 |
| Added reference deposits | 285,528,880 | 285,528,880 |
| Largest custody encoding (reconstructed bytes) | 4,100 | 4,100 |
| Maximum custody memory | 2,601,866 | 2,599,070 |
| Maximum custody CPU | 836,287,713 | 835,622,504 |

The unchanged limits are 16,384 bytes, 16,500,000 memory and 10,000,000,000 CPU. Publication maxima were 16,067/16,069 reconstructed bytes. Canonical block reconstruction does not claim the exact original submission encoding. Real burned-voucher remint used 14,814,686 memory / 4,878,918,130 CPU; native return used 13,669,060 / 4,336,319,577.

Fifteen compiled, signed scaling contexts cover 0/32/64 pending channel commitments, authenticated cursors up to 1,000 channels and escrow inventories up to 1,024 shards with 64 siblings. Maxima: 4,249 bytes, 2,622,275 memory, 847,752,944 CPU and 1,325,694 fee. These seeded offline fixtures establish per-step bounds; a thousand-object ledger rehearsal is not claimed.

## Recovery fixes and independent review

The actual V3 handover exposed asynchronous Yaci table publication: an output could precede its transaction row and the history cursor could skip the move permanently. The indexer now waits for complete canonical transaction/input/output data, verifies body hashes, derives certificate events from those same bodies, and persists checkpoints. A versioned cursor rebuilds older projections. Rollback also rebuilds chain-derived pool ages. The Gateway no longer writes delayed chain-derived reads back into that cache. Twenty-seven real PostgreSQL regressions plus forty service tests pass; independent bounded re-review found no remaining concrete issue in this cache-ownership path.

Earlier independent reviews prompted fixes for exact authority/accounting checks, shared-output satisfaction evidence, canonical input chains, partial-migration history, delayed proof heights, packet evidence and node-witness transport. The actual node fallback returned an independently authenticated 9,210-byte block with Yaci disabled; a silent peer timed out and observed socket closure after 30,109 ms. The latest requested submission-journal review was tool-blocked and remains a review gap. Agent reviews and local rehearsals are not an independent audit.

The unchanged 350-entry consensus-history cost fixture exposed a Lucid evaluator parser bug. The [checksum-pinned evaluator correction](../cardano/vendor/uplc/README.md) changes only the existing bitwise-cost length guard in upstream `uplc 1.1.22`; it retains execution semantics and passes the complete supplied model/scripts/budgets unchanged. Both npm and Deno resolve the same verified artifacts. An exact rebuild reproduced them, all 88 parameterized validators matched the former evaluator byte-for-byte, and the previously failing real consensus-history suite now passes (15 tests, one existing fixture-export test ignored). No production limit or fixture was weakened.

## Executable checks


Commands run from the feature worktree unless a directory is named:

| Check | Actual result |
| --- | --- |
| `cardano/onchain`: `aiken check -m migration_budget_equivalence -m voucher -m trace_registry --seed 462 --max-success 1000` | 98 passed: 59 unit tests and 39 properties, each property configured for 1,000 successes. Independent scalar metadata encoding, declarative directory constraints, and independent Merkle-root traversal are included. |
| `deno test -A --config cardano/offchain/deno.json cardano/offchain/scripts/migrate-deployment.test.ts` | 6 passed: concurrent expired rebuilds preserve one immutable winner, plus argument constraints, lost RPC response, concurrent executors, expiry with original-input pinning/substitution rejection, and canonical adoption of an older revision after a simulated rollback. Journal isolation tests use real Emulator transactions; this is not a chain rollback rehearsal. |
| `cardano/gateway`: `npm test -- --runInBand lucid.service.trace-registry-prelude.spec.ts packet.service.denom-regression.spec.ts` | 8 passed. These are focused builder/service regressions, not on-chain lifecycle evidence. |
| `relayer`: `cargo test -p ibc-relayer --lib chain::cardano::signing_policy -- --nocapture` | 43 passed, including outbound refund sender normalization and separate signer authentication. |
| `relayer`: `cargo test -p ibc-relayer --lib trace_registry_prelude_is_rejected -- --nocapture` | 1 passed. An otherwise valid single receive cannot authorize an unsupported prelude. |
| Full Gateway suite with `BRIDGE_HISTORY_TEST_DATABASE_URL` pointing to the isolated test database | Indexer/evaluator rerun: 140 suites, 1,183 tests passed, zero skipped; includes real PostgreSQL history tests and the accepted-anchor, wire-encoding, migration-pause, WebSocket timeout and node-witness regressions. |
| Final cache ownership regression: `BRIDGE_HISTORY_TEST_DATABASE_URL=… npm --prefix cardano/gateway test -- --runInBand yaci-bridge-history-sync.spec.ts yaci-history.service.spec.ts` | 67 passed (27 PostgreSQL indexer and 40 service tests). Gateway build and `lint:check` passed. The older `lint` script fails ESLint 9 configuration discovery; CI uses the passing `lint:check` command. |
| `cardano/offchain`: `deno task test:consensus-history` with Deno 2.9.6 | 15 passed / 0 failed / 1 existing fixture-export test ignored, using the unchanged 350-entry cost model and compiled validators. |
| `node cardano/vendor/uplc/verify.cjs` and the documented `build.py` command | All 16 source/artifact checksums verified; exact rebuild matched. The Deno transitive-resolution regression also passed. |
| Gateway witness transport/header focused tests | 15 passed; actual node and real silent-peer probes also passed as described above. |
| Optimized-blueprint migration suite with distinct compiled V2/V3 fixtures | 21 tests and 18 steps passed, rerun with the compatible fifteen-minute V3 fixture; Emulator population is not a substitute for the real two-chain rehearsal. |
| SDK runtime `npm run build && npm test` | 91 passed, zero skipped; a burn-builder test was updated to await the now-asynchronous registry lookup. |
| Relayer `cargo test -p ibc-relayer --lib` | Final rerun: 275 passed, zero skipped, including the delayed scheduling regression. |
| Relayer `cargo fmt --all -- --check` and `cargo +1.85.0 clippy -p ibc-relayer --lib --tests -- -D warnings` | Passed with the pinned CI toolchain. The initial local default Rust 1.91 Clippy invocation failed on an unchanged manual `Default` implementation in `relayer-types`; no lint was suppressed. |
| Relayer delayed scheduling regression through real runtime request/reply boundary | Passed in both relay directions: Cardano proof height 33 remains 33 even with a checkpoint cursor at 50. A non-packet fixture initially did not enter the delayed branch and was corrected to an actual packet event; assertions were retained. |
| `aiken check --deny -m migration_packet_ --seed 462 --max-success 1000 --property-coverage relative-to-tests` | 6 passed: 4 unit tests and 2 properties with 1,000 iterations each. Claim mutations covered commitment (260), receipt (260), acknowledgement (247), and proof-floor (233) cases. Seed 462 reproduces the run. |
| `python3 scripts/ci/test-migration-guards.py --report …` | 4 guard controls, each evaluated in production and a temporary mutant: 16 full-validator checks passed. Quorum, principal conservation, core completeness and packet-datum preservation each reject the same attack that becomes accepted with only that guard removed. |
| `aiken check --deny -m migration_adversarial_cleanup --seed 462 --max-success 100` | 3 passed: the exact deployer-signed HostState shutdown passes retained legacy rules and current registry authentication, then the upgrade-capable wrapper rejects it in both Ready and Proposed. These isolated validator controls do not claim a legacy deployment migration or balanced-ledger shutdown acceptance. |
| `deno check --config cardano/offchain/deno.json cardano/offchain/scripts/migrate-deployment.ts scripts/ci/export-migration-budget.ts scripts/ci/migration-cost-overrides.ts` | Passed. |
| Off-chain `deno task fmt:check`, `deno task lint`, `deno task check` | Passed. Journal tests reran after lint-only Promise-return fixes: 6 passed. |
| Repository invariant, lint-suppression, Aiken layering and fuzz-import checks | Passed. |
| `python3 scripts/ci/test-migration-evidence.py` and `node --test scripts/ci/test-migration-packet-evidence.cjs` | 12 Python and 9 Node tests passed, including optimized-Python rejection, wrong shard/principal/provenance, changed receive payload, acknowledgement/timeout ambiguity, exact Cosmos packet events and indexed message bodies, raw witness/body authentication, occupied-port preflight, and external-payer/signature/deposit accounting controls. Added to Gateway CI. |

The whole-project optimized-source rerun (`aiken check --seed 462 --max-success 100`) passed all 1,440 tests: 1,284 unit tests and 156 properties.


## CI and remaining limits

Remote runs [35238366088](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35238366088) and [35238761405](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35238761405) failed. The obsolete quality-ratchet exception was removed, and the extended-cost-model failure is fixed and verified locally. The first fresh populated CI job failed because Yaci did not index its first block within 600 seconds, before population. Startup diagnostics are now retained; its root cause is not yet established. Run [35245499807](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35245499807) is rerunning all checks and the complete fresh rehearsal at `f7d904d05`.

The [historical ledger](migration-rehearsal-history.md) retains earlier failures, including a separate sparse-epoch run that failed counterparty continuity. That run is not acceptance evidence for the current bridge.

Remaining work: finish the fresh CI run. The non-publishing [Gateway image build 35246157990](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35246157990) passed at `18969b371`; publication was skipped. A real chain rollback rehearsal and independent review of the latest journal revision remain outstanding. Packet properties use an independent event-log/commitment oracle but are compositional rather than a full randomized balanced-ledger asset model. Arbitrary approved successor logic can steal later; immutable policy/kernel faults, lost authority, unavailable history and irrecoverably expired clients remain outside the recovery guarantee.
