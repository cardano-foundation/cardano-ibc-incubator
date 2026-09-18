# Migration validation summary

This records what was executed and what it established. Raw per-test JSON, transaction dumps and repeated historical reports are not part of the source diff. Executable tests, independent oracles, negative controls and devnet rehearsal scripts remain in the repository. Detailed outputs are available in the linked CI artifacts and, for earlier local runs, [the existing evidence history](https://github.com/cardano-foundation/cardano-ibc-incubator/tree/72997afe1bca6494c47079d1fd34126d67b75a6b/docs/evidence).

## Tested revisions

| Revision | What ran | Result |
| --- | --- | --- |
| `79dc91f53` | Full populated profile-v3 rehearsal on a disposable five-producer Cardano devnet and a real Cosmos counterparty, using Gateway, Hermes and actual compiled validators | [Rehearsal job passed](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35287600121/job/105423347310). The overall workflow failed formatting only. |
| `41dfd0c5e` | Formatting correction with byte-identical V1/V2/V3 compiled artifacts; complete checks-only CI | [Passed](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35288005940). |
| `e46111cfe` | Later hex-decoding and Merkle-update cost reductions; local compiled tests, properties, negative controls and operator measurements below | All listed local checks passed. [Fresh populated CI](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35342732725) was still running when this summary was updated; its result must be assessed separately. |

`72997afe1` added evidence and clarified test-report scope without changing compiled contracts. Subsequent evidence cleanup likewise changes no contracts or builders. The relayer revision is `0deb0ab5`. Local tools were Aiken `1.1.21+42babe5`, Deno `2.9.6` and Node `25.8.1` on macOS arm64; the populated CI used Aiken `1.1.21`, Deno `2.9.6`, Node 22 and Rust `1.85.0` on Linux. The supported fresh baseline is `cardano-ibc-compatible-v3`.

## Scenarios demonstrated on the local devnet

The completed `79dc91f53` run populated eight authenticated objects, two channels, two escrow shards and two users. It used real transfers and counterparty verification, rather than only seeded accounting fixtures.

- **Repeated replacement:** V1→V2→V3 installed genuinely different spending hashes for HostState, client, connection, channel and transfer/escrow, using the same migration mechanism twice.
- **Assets in both directions:** Cardano-native assets remained in escrow against remote vouchers; existing Cardano vouchers for foreign-origin assets retained their policy IDs and asset names. Original vouchers could be returned/redeemed after migration without holder participation in custody moves.
- **Outstanding claims:** pre-migration packets awaiting receive, acknowledgement, timeout and refund completed through the successors. A burned-voucher return timed out and reminted the original voucher asset. Ordinary new traffic also worked after activation.
- **Counterparty continuity:** the original routes and Cosmos Cardano client accepted post-activation proofs settling old obligations in both generations. Final verification canonically rechecked all 37 packet receipts and 18 custody transactions.
- **Interruption:** handover stopped during mixed custody and resumed in another process. Historical proof access remained available; ordinary operations were gated during migration.
- **Real chain rollback:** one of five producers was isolated, a real MoveCore transaction was included on its minority fork, and the remaining four advanced past that transaction's expiry. After reconnection, all five ledgers and the provider restored the original registry; the same plan/outbox resumed and completed migration.
- **Conservation and funding:** original state, assets and outstanding obligations were verified across both handovers. A separate ADA-only executor funded the custody transactions. V2 used 12,360,347 lovelace in fees plus 676,670 in added deposits; V3 used 12,398,916 in fees with no added deposits. Approval and reference publication are separate costs.

The [populated-migration artifact](https://github.com/cardano-foundation/cardano-ibc-incubator/actions/runs/35287600121/artifacts/10529747775) contains the compiled artifacts, snapshots, canonical receipts and detailed measurements for that run. This is successful local/devnet acceptance of those revisions, not an independent audit or a production finality guarantee.

## Latest local tests

These ran against `e46111cfe`; selections overlap and should not be added together as a unique-test total.

| Check | Result and coverage |
| --- | --- |
| Aiken smoke suite | 1,576 passed, including 71 properties at one iteration. |
| Broader Aiken suite | 261 passed, including 27 properties at 1,000 iterations, seed 462. Covers HostState, migration attacks, packet state and budget equivalence. |
| Focused decoder/tree checks | 17 passed, including four properties at 1,000 iterations. Independent decoding oracle, every character value in both nibble positions, varied values/lengths and Merkle sibling occupancy; short, long and wrong-width proofs reject. |
| Guard-removal controls | 12 pairs passed: 44 full-validator outcomes and four production Merkle-function outcomes. The valid control passes and the intended attack becomes accepted when its guard is removed. |
| Production migration builders and compiled scripts | 29 tests/18 steps passed, including real deployment and two distinct successors, authorization, harmless HostState turnover, emergency restriction/restoration, stale approvals, conservation attacks and interrupted execution. |
| Deployment construction | 32 tests/57 steps passed. Distinct successor reference publications fit the 16,384-byte limit: HostState 16,282 bytes, transfer 16,278 bytes. |
| Transaction budgets | 11 retained ordinary packet/channel fixtures and 15 migration-step cases passed. The ordinary fixtures do not reproduce every first-seen upgradeable foreign-voucher receive. |
| Evidence verifiers | 14 Python and nine packet-evidence tests passed, including rejection of tampered or insufficient evidence. |
| Complete operator scaling | All ten scenarios passed, including 512 escrow shards/eight channels and an interrupted 128-shard migration. These use seeded state, production builders and compiled evaluation. |

Actual validator contexts reject restricted send/receive/acknowledgement/timeout/pruning and held migration operations, while permitted client maintenance and heartbeat controls pass. Balanced compiled transactions separately exercise the registry's emergency authority, delayed restoration, revocation and rotation. Model tests explore economic histories and generated populations; they are not substitutes for actual two-chain packet settlement.

The Gateway→SDK regression feeds Gateway's published manifest into the actual SDK normalizer, preserving an explicitly selected unlabelled legacy mode and rejecting ambiguity/conflicts. Earlier recorded component checks passed 97 SDK tests, 1,187 Gateway tests with PostgreSQL enabled and none skipped, and 43 relayer tests. Their component source trees are unchanged through `e46111cfe`; this credit does not qualify later changed contract artifacts.

## Recovery time and limits

The completed five-node run required nine canonical custody transactions per handover. Begin→Activate took **718 seconds for V2, including rollback**, and **178 seconds for V3, including interruption**. Gateway restart and governance/restoration delays are additional. Confirmation means provider inclusion plus canonical output adoption, not a prescribed stability depth.

On the latest local emulator run, 512 shards/eight channels required **523 transactions**, one inventory reconstruction, 512 proofs and 23.900 seconds. Interrupting a 128-shard migration required two authenticated reconstructions and 132 transactions. These timings measure emulator execution, not network recovery. The cache removes repeated inventory rebuilding but preserves registry-root verification and completeness; it does not remove serialization. General custody transaction count remains **C + L + H + N + 3** for clients, connections, channels and escrow shards.

The demonstrated devnet population is two channels, two holders, two escrow shards and eight authenticated objects. A production-scale downtime envelope and worst-case supported receive-budget headroom remain unqualified. Earlier populated runs at `f317d9411` and `c8961ff40` exceeded the memory limit on a foreign receive; the later `79dc91f53` population passed. Neither that pass nor isolated cost savings proves that every supported receive state fits. Fresh populated/rollback acceptance of `e46111cfe` remains separate while its CI is pending.

## Reproduction

The [main CI workflow](../.github/workflows/ci.yml) integrates the checks; [the populated workflow](../.github/workflows/migration-rehearsal.yml) specifies the exact build, deployment, successor and two-chain commands. Principal entry points:

- `aiken build --deny --trace-level silent` and `aiken check --deny --seed 462 --max-success 1` from `cardano/onchain`; focused properties use `--max-success 1000`.
- `deno task test:migration`, `deno task test:deployment` and `deno task test:tx-budgets` from `cardano/offchain`. The two-successor test supplies `MIGRATION_SUCCESSOR_V2_BLUEPRINT` and `MIGRATION_SUCCESSOR_V3_BLUEPRINT`, built with `scripts/ci/build-migration-successor.py` at 600000/900000 ms respectively.
- `scripts/ci/test-migration-guards.py`, `measure-migration-scaling.ts` and `measure-migration-operator.ts` produce detailed reports when run; those generated reports need not be committed.
- `gh workflow run ci.yml --ref <candidate-branch> -f populated_migration=true` runs the owned five-node/two-chain rehearsal, including `--exercise-rollback`.

See the [requirement mapping](migration-requirements.md), [containment specification](emergency-containment-audit.md) and [operator runbook](migration-operator-runbook.md) for supported behavior and failure boundaries. No mainnet deployment, live authority change or real user funds were used.
