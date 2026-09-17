# Migration review follow-up: approval, scale, coverage and deployment capability

**Historical follow-up:** the measurements below precede the emergency-restriction ABI change. They remain evidence for the unchanged approval/cache mechanisms, not whole-candidate acceptance. See the current containment specification.

This review starts at `204d508a923edacc5a13ab4ece18b3e6cf5e4c1a` on the feature worktree. It does not alter the original worktree. No live immutable deployment is assumed or claimed recoverable. On-chain migration rules and compiled baseline validators are unchanged by this follow-up.

## Durable approval versus construction inputs

Previously `prepareMigration` saved HostState/transfer-root outrefs and `authorizeMigration` required those exact outputs to survive. A harmless HostState heartbeat invalidated the reviewed plan. Approval also referenced both volatile outputs, so traffic during signature collection invalidated the approval transaction.

Authorization now resolves HostState by its original NFT, authenticates datum policy, active control/transfer registration, then resolves the original module NFT. The production builder checks exact current role addresses (including staking credentials), module/port token quantities, the reviewed escrow root and maximum core counts. Preparation outrefs remain in the reviewed artifact as provenance and are never used as authorization identity. The complete artifact digest remains unchanged through continuation.

The registry input, source generation and proposal nonce remain pinned. Every authority rotation passes through a proposal that increments the nonce; cancellation cannot restore an old approval epoch. A source implementation change necessarily changes generation. All five successor scripts/addresses and compatibility are bound by the proposal and checked against applied bytes. On-chain `Begin` requires the exact authorized proposal, delay/expiry, authentic current HostState/root, inventory, count limits, transfer registration and all successor references. Ordinary state commitments may advance and are preserved at handover; they are deliberately not approval snapshots. Count limits are upper bounds, not permission to rewrite counters. New state creation cannot lower counters through valid ordinary continuations.

Between off-chain preflight and approval, a new object/inventory change may race the transaction. Approval need not fail in that race, but Begin rejects out-of-plan inventory/counts before any move. Cancel and review a new plan. This is intentional fail-closed behavior, distinct from harmless UTxO turnover. A stale provider can cause failed construction/submission, not bypass the registry input or on-chain Begin checks.

Regression scope: `migration.test.ts` executes real bootstrap, preparation, approval, actual ordinary heartbeats, Begin and two successors with actual UPLC evaluation. Heartbeats occur before authorization, after approval construction and after authorization. Incompatible-state preflight cases inject provider responses and are explicitly not claims of valid ordinary creation. `migration-operator.test.ts` also exercises same-token/datum/value transfer-root turnover before approval and Begin; those continuations are seeded, so that test establishes production resolution/authorization behavior, not the ordinary root-spending transaction that created the continuation. Existing channel/packet validators separately cover ordinary paths.

## Complete recovery scaling

`measure-migration-operator.ts` invokes production prepare/authorize/next-step builders and evaluates every approval/handover transaction. Initial NFTs/population/reference scripts are seeded. One channel, no clients/connections, N escrow shards, two packet commitments; every escrow asset/datum and channel datum is checked after activation. This is not a population-creation or two-chain test. Wall times are local emulator measurements, not network recovery estimates.

| Escrow shards | Handover tx | Uncached entries / trees | Cached entries / trees | Uncached seconds | Cached seconds |
|---:|---:|---:|---:|---:|---:|
| 2 | 6 | 3 / 2 | 2 / 1 | 0.283 | 0.259 |
| 8 | 12 | 36 / 8 | 8 / 1 | 0.537 | 0.490 |
| 32 | 36 | 528 / 32 | 32 / 1 | 1.871 | 1.408 |
| 128 | 132 | 8,256 / 128 | 128 / 1 | 10.885 | 5.261 |

Measurements use distinct native denominations assigned to authenticated channels; exact-candidate source and results are retained in the evidence index. At 128 shards uncached construction took 7.782s and evaluation/submission 3.100s; cached construction 2.165s and evaluation/submission 3.093s. Maximum signed handover transaction was 4,136 bytes. These measurements use Emulator default protocol parameters; separate compiled budget checks use the retained protocol-10 cost profile.

Uncached inventory work is `N(N+1)/2` entries, N tree constructions, N witnesses; depth-64 hashing work is O(64N²), with repeated sorts. Cached work is one O(64N) construction, one sort O(N log N), N depth-64 witnesses and incremental deletions. Memory remains O(64N). A restart/unknown canonical transition triggers reconstruction of the remaining set. This optimization does not reduce transaction count.

Provider calls in the measured one-channel setup, including preparation/approval but excluding wallet-provider internals: `2N+16` unit queries, `2N+14` reference-outref queries, and address queries `2N+5` uncached / `N+6` cached. Reference-holder entries are still enumerated every step, adding O((N+core objects)R) for R retained reference outputs. Baseline hash/alias validation is also repeated. The measurement reports these separately from escrow inventory entries; it does not pretend they disappear.

Every governance change, Begin, MoveCore, MoveTransferRoot, MoveEscrow and Activate serializes on the registry. Total handover is `N+C+L+H+3` transactions. The operator waits for provider observation/output adoption, not configured k-deep finality. Ordinary bridge service is unavailable from Begin through Activate and operational manifest installation. At assumed 20-second observation intervals, 1,000 shards and ten core objects imply 20,260 seconds (~5.63 hours), before retries, congestion or manifest installation. This is extrapolation. Multi-shard batching/parallel registry lanes and network recovery SLAs are not implemented or demonstrated.

The cache verifies every constructed witness against a freshly inspected registry commitment. Pending deletion only becomes local progress on observing its exact predicted root. Retry with unchanged root repeats the same valid witness. Other progress/rollback resets from provider inventory and verifies its complete root. Independent-root tests cover rejected/unconfirmed submission, competing removal, restart, stale inventory, duplicate inventory and rollback. These are deterministic cache/provider simulations; an actual multi-node rollback rehearsal remains unverified.

## What the properties explore

The Aiken event-log property varies packet operation histories, values/selected sequences, proof heights and handover timing in one channel. It does not model escrow supply or multiple assets. Its corrupted-handover property samples four mutations of one fixture; 1,000 samples are **not** 1,000 materially different economic scenarios. Existing fixed adversarial cases remain useful regressions.

New economic-model exploration generates 100 histories (seed 462), 2–6 independent route ledgers, 40–180 randomized operations, amounts, selected outstanding packets, success/refund choices, and three partial migrations. An append-only journal independently reconstructs balances for comparison with the stateful model. Coverage requires burns in both directions, redemption, remint, refund and partial migration. It is a separate economic model, not production settlement acceptance; its route ledgers abstract channel/user/asset combinations and do not verify packet proofs.

New production exploration generates 16 populations (seed 462), 2–5 channels, 2–12 escrow shards, 0–16 commitments per channel and optional interruption. Every governance/handover transaction executes actual compiled validators through production builders. Post-migration checks compare original assets and exact channel/escrow datums. The initial state is seeded; these tests do not create vouchers through real packet traffic or settle those commitments. Combining arbitrary generated packet histories with actual two-chain settlement remains a coverage gap.

Guard controls deliberately remove production checks and require valid positive controls plus formerly rejected attacks to succeed. They cover authority, delay, value preservation, packet-claim preservation and Moving's ordinary-operation gate. The inherited critical mutation harness was repaired to target the relocated production transfer implementation; native amount and commitment mutations previously failed at a missing anchor, not a security assertion. Four critical mutants now have successful controls and are killed. No compile failure is counted as a killed mutant.

## Deployment and compatibility

`index.ts` validates explicit `IBC_DEPLOYMENT_MODE` before network access. `upgradeable` requires valid governance; `legacy` rejects governance configuration and is explicitly immutable. The deployment API also rejects omitted/mismatched mode before any deployment transaction. Artifacts expose the selected mode. Gateway startup requires explicit selection for unlabelled legacy artifacts; a recovery label with missing registry configuration fails. SDK manifest normalization defaults to requiring recovery unless legacy is explicitly selected.

Readiness follows `findUtxoAtHostStateNFT` → `migrationReference`: it resolves the actual registry NFT/address/datum, original Host identity/state policies, current generation/compatibility and five full role addresses, then resolves current HostState and its historical proof anchor. These checks are not satisfied by the `deploymentMode` label alone. They rely on the configured chain provider and the reviewed deployment identities, not on inferring trustworthy code from an arbitrary NFT supplied by an attacker.

Only the five spending roles (HostState, client, connection, channel, transfer escrow/root) can be replaced under the compatible profile. Registry kernel/NFT policy, original state/asset policies, voucher policy and names, port/module identities, operation/proof/session/recovery/trace/metadata dependencies and commitment encodings remain immutable. Activation permits only its proven transfer-port dependency update. Arbitrary schema/root rewrites, replacing immutable policies, generic channel upgrade, Mithril migration, and a new route/asset masquerading as continuity fail closed. A bug requiring changes outside this boundary may not be recoverable. Arbitrarily approved replacement spending code remains trusted with funds.

There is still **no immediate emergency restriction**: the previous containment audit remains applicable. This follow-up does not claim to repair that separate gap.

## Candidate acceptance

See `docs/evidence/migration-review-result.json` for source/tree identity, tools, artifact hashes, commands and current results. Earlier populated V1→V2→V3 success belongs to its retained historical source and cannot substitute for this candidate. Fresh CI run 35262551511 was started at `73984e8c2` and is likewise not acceptance of this follow-up. Exact-current populated two-chain acceptance and real rollback must be stated separately from local model/builder/budget results.

Independent bounded static review of the approval/Begin boundary, cache authentication and incremental deletion found no concrete defect. The reviewer did not execute tests. This is not an audit, and the previously blocked independent submission-journal review remains outstanding.
