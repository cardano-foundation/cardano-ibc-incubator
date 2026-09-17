# Production-readiness review

Implementation candidate: `c8961ff403006f77f54e02c4401895dd642227f9`, with relayer `0deb0ab5`. The work remains on `feat/462-state-preserving-redeployment`; no live deployment or real user funds were changed. Current compiled artifacts use the fresh `cardano-ibc-compatible-v3` baseline. Historical seven-field registry results are not whole-candidate acceptance.

## Findings and implemented changes

| Hypothesis | Finding and evidence |
| --- | --- |
| The old containment audit describes a capability that does not exist | **Confirmed for the previous candidate, fixed.** The registry now supports immediate emergency-quorum `Restrict`; all affected spending wrappers enforce its operation scope. Handover hold also blocks Begin, every move and Activate. Governance/code authority cannot use emergency authority to install code or waive delay. |
| An approved unsafe successor can defeat containment by permissionless activation | **Rejected by current validator execution after the hold is included.** Restriction mask 8 blocks activation; mask 1 survives activation. Inclusion ordering, rollback and a malicious replacement that ignores the wrapper remain explicit limits. |
| Restoration approved by outgoing governance can survive its rotation | **Confirmed by independent review and fixed.** Completing rotation clears pending restoration while retaining the restriction mask, epoch and emergency authority. The chained compiled-transaction regression verifies both revocation and a fresh delayed restoration under incoming governance. |
| Compromised emergency keys can veto their own removal | **Confirmed and fixed.** A separate delayed authority-only approval survives restrictions in Ready, Proposed and Moving, and changes only the emergency keys. New keys cannot clear the hold without a separate delayed permission restoration. Independent review found and corrected a stale-generation test that initially failed for an unrelated output mismatch. |
| Gateway accepts an explicitly selected unlabelled legacy deployment but publishes no mode | **Confirmed and fixed.** Gateway publishes its validated selection. The round-trip regression passes the actual exported JSON into the actual SDK normalizer; ambiguous or conflicting selections still reject. |
| Larger successor scripts remain publishable | **A real failure was found and fixed.** The first changed transfer implementation exceeded the 16,384-byte limit. Removing its redundant retirement test and unused retirement-only hash parameter leaves retirement rejected by `validate(False, ...)`. The final changed transfer publication is 16,268 signed bytes; the retirement regression first proves its retained withdrawal witness is otherwise valid. |
| The inventory cache removes serialized recovery downtime | **False.** It eliminates repeated authenticated inventory reconstruction, not the registry dependency or transaction count. No production-scale recovery SLA is established. |

The earlier durable-approval fix is retained: HostState and transfer-root outrefs are construction observations, while source identity/generation, governance nonce, successor configuration and reviewed inventory/count constraints remain authenticated. The cache is still checked against each newly observed registry commitment and rebuilt after unexpected progress, interruption or rollback. Explicit deployment-mode selection is retained; upgradeable deployment now also requires a separate explicit emergency quorum.

## Containment operations and release timing

See [the implemented authority/state-transition specification](emergency-containment-audit.md) and [operator commands](migration-operator-runbook.md). Mask 9 stops packet/topology/pruning activity and holds handover; mask 15 additionally stops client updates and heartbeat. Restricted packet operations include receives, returns, acknowledgement, timeout, refund and remint. This preserves their recorded claims while settlement pauses; it does not freeze the counterparty or its deadlines. Client maintenance and heartbeat are available under mask 9 outside `Moving`. Fixed independent session work and read-only proofs remain available.

The emergency quorum only tightens restrictions. Exact restoration scope/authority requires governance approval and the unchanged minimum 24-hour delay. A fresh restriction revokes a pending permission restoration, including when the mask stays the same. It preserves a delayed authority-only replacement ticket (`mask = None`), preventing the outgoing emergency quorum from vetoing removal. That ticket preserves the latest mask and partial-migration progress. Rotation revokes outgoing restoration approvals. Source-generation restoration tickets cannot silently restore a successor generation.

**Incident downtime is longer than custody handover.** A conservative workflow restricts immediately, reviews/approves replacement and restoration-to-mask-1, waits the approval delay, migrates with traffic still restricted, then approves restoration-to-mask-0 in the successor and waits its delay. That includes another governance delay beyond the measured Begin-to-Activate interval. A restoration-to-mask-0 approved while the source is still ordinarily active can reopen vulnerable source code once mature; do not use it to disguise the extra outage. Restoration approved during `Moving` can mature while the phase gate still blocks all ordinary operations, but must execute before activation changes its generation binding. Its own delay still applies. These are intentional safety/availability tradeoffs, not a minute-scale incident-recovery claim.

## Executed local checks

On the final implementation, the focused migration transaction suite passes with genuinely different V2/V3 scripts, real production deployment/builders, emulator ledger submission and actual UPLC evaluation. It includes harmless HostState turnover around approval, on-chain restriction/restoration and the governance-rotation regression. It is not the populated two-chain rehearsal.

Current completed checks include 247 broader Aiken tests (26 properties, seed 462, 1,000 iterations), 66 emergency validator cases, both port-order controls, eleven guard-removal pairs (44 validator outcomes), 29 migration tests/18 steps, 32 deployment tests/57 steps, 97 SDK tests, 1,187 Gateway tests with PostgreSQL enabled and none skipped, and 43 relayer signing-policy tests. Moving key replacement is exercised in actual Aiken validator contexts; the balanced compiled transaction sequence exercises Ready. These evidence levels are distinct. The broader and emergency Aiken selections overlap and must not be summed as distinct cases.

The [current evidence index](evidence/migration-authority-recovery-result.json) records source/artifact hashes, commands and raw reports. The [earlier containment candidate record](evidence/migration-emergency-review-result.json) remains tied to `f317d9411`, including its broader 247-test Aiken run; it is not silently relabeled. Its CI smoke failure was an old seven-field port-order fixture. The updated fixture passes its positive and negative controls against the current validator and is explicitly not a legacy-recovery demonstration.

Fifteen retained protocol-10 migration budget cases pass on the current scripts. Maximums are 4,295 signed bytes, 2,656,205 memory units and 860,211,116 CPU units. A 1,024-shard case tests a single authenticated move at a large inventory, not completion of 1,024 moves.

## Scale and confirmation policy

For C clients, L connections, H channels and N escrow shards, custody handover requires **C + L + H + N + 3** serialized transactions. Approval, script publication and emergency/restoration control are additional. The operator waits for provider inclusion and canonical output adoption; it does not establish k-deep finality. Public-network latency, congestion and rollback can increase downtime without a bounded upper limit.

Current compiled operator measurements use seeded populations and the real prepare/authorize/next-step builders. They execute every migration transaction, but are emulator measurements under concurrent local test load:

| Shards | Transactions | Uncached inventory entries / trees | Cached entries / trees | Uncached / cached seconds |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 6 | 3 / 2 | 2 / 1 | 1.130 / 0.925 |
| 8 | 12 | 36 / 8 | 8 / 1 | 1.789 / 1.831 |
| 32 | 36 | 528 / 32 | 32 / 1 | 6.123 / 4.826 |
| 128 | 132 | 8,256 / 128 | 128 / 1 | 35.797 / 13.766 |

Each mode computes N proofs. Cached deletion costs stay proportional to the depth-64 tree; canonical-root mismatch forces reconstruction, never acceptance of cached authority. Reference enumeration and applied-baseline validation remain per-step work. The preserved cache regression covers stale data, a competing executor, interruption and rollback.

Historical real-node receipts for the earlier eight-object implementation span 186 and 194 slots (one-second slots), nine custody transactions each. Those measurements include that rehearsal's interruption and provider-adoption policy. They are not current-candidate measurements, a multi-node rollback test or a production SLA. An assumed 20 seconds per included dependent transaction gives approximately 5.63 hours for 1,000 shards and ten core objects, before retries and operational restart. This is extrapolation.

The new real-node harness records per-command wall times, exit codes, confirmation policy and canonical Begin-to-Activate slots/blocks. Its rollback exercise isolates one of the owned five producers, includes a real move on that minority fork, waits past transaction expiry while four producers advance, reconnects, and requires all five ledgers plus the production provider to restore the original registry before resuming with the same plan/outbox. Code presence is not successful execution.

## Release blockers

Fresh populated two-chain V1→V2→V3, real multi-node rollback/resumption and final canonical counterparty settlement must pass on this candidate. CI run `35285080981` targets the current implementation and complete authority fixture. The earlier `35281948082` targets `f317d9411`; pending or failed execution is not acceptance. The rehearsal now validates the complete explicit emergency/governance fixture instead of rejecting the added emergency configuration before approval. The earlier successful rehearsal remains credited to its recorded source/artifacts only.

No supported production-scale downtime envelope has been demonstrated. The tested emulator envelope reaches 128 complete shard moves; the historical real-node population has two escrow shards/eight objects. Larger real populations, network confirmation/retry costs, incident restoration delay and counterparty trust windows must qualify an operational limit before production release. Single-object registry serialization remains an architectural ceiling; this review does not weaken completeness or claim unlimited scalability.

The bounded independent review found and verified both restoration/authority-rotation fixes, and reviewed the retirement size reduction. It was a static review, not an independent audit. Immutable policy/kernel faults, compromised replacement governance, missing proof history, irrecoverable counterparty expiry and unavailable chain inclusion remain outside universal recovery guarantees.
