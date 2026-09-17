# Emergency containment audit

This audits the upgrade-capable implementation at `73984e8c2`, with new executable characterization tests. There is no live deployment. The question is whether the first production deployment would have a usable emergency stop. **The current implementation does not provide one. Repeated compatible migration is demonstrated; immediate exploit containment is a separate, missing capability.** No production validator or authority was changed by this audit.

## What an operator can do today

An operator is not automatically an authority. `Propose` requires the registry's configured governance quorum. The old HostState deployer key has no special migration permission unless it is included in that quorum. `Begin`, bounded moves and `Activate` are permissionless execution of previously authorized decisions.

| Discovery point | Available on-chain action | Actual containment |
| --- | --- | --- |
| `Ready`, no proposal | Governance can submit `Propose(Replace(...))` for a complete exact successor, or a delayed authority rotation. There is no pause redeemer. | Proposal blocks creation of clients/connections/channels and new escrow shards. Existing transfers, receives, returns, acknowledgements, timeouts, refunds and remints remain subject to their ordinary rules. New deposits into existing shards are not stopped. Preparing/reviewing a replacement plus the approval delay leaves these vulnerable paths available. |
| `Proposed`, before `ready_at` | Governance can cancel. It cannot waive the delay, even with every governance signature. A different replacement requires cancellation and a fresh proposal/delay. | The same ordinary paths remain available. A rotation proposal is not a pause either. Proposal expiry does not halt operations; it only prevents `Begin` and permits anyone to cancel after expiry. |
| `Proposed`, mature and unexpired | Anyone can submit valid `Begin` if the exact approved successors are published and the HostState/inventory conditions hold. | `Begin` atomically enters `Moving` and moves HostState. This is the first general ordinary-operation stop. It is an irreversible custody transition to already approved code, not a way to halt while unchosen replacement code is reviewed. |
| `Moving` | Anyone can execute the remaining authenticated moves and then `Activate`. `Cancel` and a new proposal are unavailable. | Ordinary HostState operations are blocked in both generations. Independent session work remains possible. When completeness is proven, anyone can activate the approved target and restore ordinary operation; there is no separate emergency veto/unpause decision. If a new defect is discovered in that target, stopping our executor cannot keep the bridge paused. |

`minimum_delay_ms` is 86,400,000. Approval sets `ready_at = transaction.valid_to + old.governance.delay_ms`, and `Begin` requires its validity interval to start at or after that value and end by expiry. The exposure interval is at least the remaining delay (and includes preparation/review time if a replacement does not yet exist). A safe, already mature, published proposal is the exception allowing immediate submission of `Begin`; ordinary chain inclusion and rollback risks still apply.

## Enforcement and dependency trace

* [Registry types](../cardano/onchain/lib/ibc/migration/types.ak) define only `Ready`, `Proposed`, `Moving`. There is no emergency restriction field or redeemer.
* [Registry spending](../cardano/onchain/validators/implementation_registry.ak) controls proposals, delay, cancellation, moves and activation. Exact output equality prevents an authorized proposal from substituting a `Moving` output or lowering the delay. Control transactions spend the registry alone; migration transactions have their separate tightly constrained object transition.
* [Migration authentication](../cardano/onchain/lib/ibc/migration/auth.ak) requires normal operations to reference the unique registry NFT. `active_registry` accepts phase tags 0 and 1 and rejects tag 2. `preparing` is a creation restriction, not a packet-operation restriction. Ordinary guards do not inspect proposal readiness or expiry.
* [Upgradeable HostState](../cardano/onchain/validators/upgradeable/host_state.ak) calls `active_spend`, then delegates ordinary validation. While preparing, it rejects escrow-policy mint/burn; client/connection/channel mint wrappers independently require `Ready`. It does not restrict `HandlePacket`, `UpdateClient`, `Heartbeat`, existing connection/channel updates or authorized port binding in `Proposed`.
* The [client](../cardano/onchain/validators/upgradeable/client.ak), [connection](../cardano/onchain/validators/upgradeable/connection.ak), [channel](../cardano/onchain/validators/upgradeable/channel.ak), and [transfer/escrow](../cardano/onchain/validators/upgradeable/transfer.ak) ordinary branches do **not** each read the registry. Their retained validators require the HostState thread/redeemer and thus rely on the HostState gate. This contains only paths whose dependencies still enforce that coupling.
* Reserved migration redeemer 100 requires the authenticated registry input. The registry validates the exact move independently of the normal transfer/settlement implementation. It is neither an operator-selected destination nor an unrestricted spend.

The `Moving` gate blocks sends, receives (including native redemption), acknowledgements, timeouts, native refunds, voucher mint/burn/remint, pruning, final client updates/recovery and heartbeats whenever they require the ordinary HostState spend. Read-only history/proof serving and ordinary wallet-to-wallet transfers of existing assets do not spend that bridge state. Session creation, owner-authorized verification and owner cancellation/burn remain independent of the registry: the fixed [session policy](../cardano/onchain/validators/minting_tendermint_update_session.ak) and [session spender](../cardano/onchain/validators/spending_tendermint_update_session.ak) do not read it. Applying a completed session to the client still requires the blocked HostState update.

## The old shutdown is unavailable

The HostState wrapper explicitly rejects both `EnterShutdown` and `FinalizeShutdown`; the retained `validate_live` function also rejects them. Other upgradeable wrappers reject their `Reclaim*` paths, and core state policies no longer expose their retirement burns. The off-chain shutdown entry point rejects migration-enabled manifests. Retained reference/metadata cleanup additionally needs an authenticated `ShuttingDown` HostState, which this profile cannot enter through its permitted transitions. Calling the old CLI or attaching old script bytes cannot spend an output locked by the new wrapper hash.

The former shutdown was a drain/retirement mode, not universal containment. It blocked new native source escrow and core creation but allowed voucher returns and settlement/refunds. The transfer validator's `OnChanCloseInit` callback returns false, so local channel close-init is not a substitute emergency switch either. Neither the old drain mode nor today's delayed handover solves the stated arbitrary settlement-path bug.

## Proposed restriction capability — not implemented or demonstrated

The smallest defensible addition is an authenticated restriction state **orthogonal to the migration phase**, with an explicit, separately configured emergency quorum. It must be part of the initial baseline. An immediate `Restrict` transaction would spend only the registry and recreate its NFT/value/address with identical implementation, fixed identities, governance, proposal and migration progress. It may only tighten enumerated restrictions and advance a restriction nonce; it cannot select code, move escrow, rewrite commitments, reduce an approval delay or reclaim deposits. No developer/deployer key should acquire this permission by default.

Recommended operation policy:

| Restriction | Stop | Keep available |
| --- | --- | --- |
| Packet halt, for a transfer/settlement incident | Every send and receive; native redemption; voucher mint/burn/remint; acknowledgements, timeouts and refunds; packet-history pruning; new topology, application bindings and escrow creation. A settlement bug makes an unconditional refund exemption unsafe. | Authenticated history/proofs, owner session verification/cancellation, migration planning/approval/cancellation before Begin, and bounded migration. Permit client updates/recovery and a strictly state-preserving heartbeat only through audited maintenance paths that cannot combine escrow/channel spends, protocol-asset movements or unrelated mint/burn with maintenance. |
| Broader ordinary-operation halt, when proof/client/HostState logic is suspect | Also stop client updates/finalization and any suspect maintenance path. | Registry control and the independent migration path. Read-only proofs and unaffected fixed session operations remain outside the ordinary HostState gate; there is no claim that a registry flag can stop a fixed script that never consults it. |

Every affected value-spending wrapper should check restrictions **before** delegating ordinary logic, rather than relying only on the possibly vulnerable application's requirement to include HostState. Maintenance must be an exact transaction-level whitelist, not a redeemer label an attacker can attach alongside another spend. Consuming the registry invalidates transactions still referencing its pre-restriction output. Transactions confirmed before restriction inclusion, and rollback of the restriction itself, cannot be retroactively prevented.

The emergency authority may tighten restrictions only; it cannot clear them or install replacement logic. Restoration should require normal governance approval with the existing delay, bound to the exact deployment, implementation generation, restriction scope and latest restriction nonce. A later tightening invalidates an older relaxation approval. Proposal expiry/cancellation, authority rotation and implementation activation must preserve restrictions; none should silently reopen vulnerable traffic. Rotation of a compromised emergency quorum must be possible through normal delayed governance. This separates availability-control power from code-installation power, though the emergency authority can still cause denial of service. Arbitrary replacement-code approval retains the existing governance theft risk.

Restriction changes must leave all asset identities, balances, packet commitments/receipts/acknowledgements, sequences, refund/remint obligations and supporting history intact. Paused settlement means claims remain recorded, not that their timely eventual execution is guaranteed. The remote chain continues, packets may time out, and client trust windows continue to elapse. Preserve historical proofs and client continuity where safe; otherwise recovery depends on the supported client's actual recovery rules. Never drain/reclaim backing or erase obligations to implement a pause.

Implementing this requires coordinated registry ABI/decoder, wrapper, builder, manifest and operational changes, plus budget checks and a new populated rehearsal. The audit tests below establish the **current gap**; they are not evidence for the proposed mechanism.

## Limits even with restrictions

Containment cannot reverse already confirmed theft, stop ordinary transfers of wallet-held vouchers, freeze the remote chain, or repair expired counterparty trust automatically. It cannot cover arbitrary bugs in an immutable minting/proof/support policy or a path that bypasses all restriction guards; those require a separately enforced restriction dependency. It also cannot reliably recover from a broken registry/NFT policy/migration mechanism, lost emergency authority, unavailable chain inclusion, missing indispensable history, or malicious approved successors that omit the guards. Registry-only restriction improves independence from ordinary bugs but does not remove those trust and availability boundaries.

## Executable evidence

The new tests reuse existing root/packet fixtures and execute the complete upgradeable HostState validator in Aiken's UPLC evaluator. Seven operations are tested in `Ready`, replacement delay, rotation delay, expired proposal, and `Moving` source/successor contexts. Positive controls validate the same normal operation. These are isolated validator contexts; they do not re-prove balanced ledger reachability, counterparty proofs or transfer application execution. Separate registry transaction tests use production builders and actual compiled scripts with local UPLC evaluation.

Results: **243 Aiken tests passed** (222 unit tests and 21 properties at seed 462, 100 iterations each), including all 44 new containment cases. The run includes actual session creation/verification/cancellation and migration approval/cancellation/rotation/Begin/moves/activation, as well as the legacy-shutdown controls and channel-close rejection. The **four filtered Deno tests passed**, including real registry mint/approve/cancel transactions and rejected unauthorized approval. **All 20 guard-control validator checks passed** across five production/mutant pairs, including the new phase-gate control. The earlier standalone HostState matrix passed 42/42; two subsequent tests establish that full governance signatures cannot skip the delay or turn proposal approval directly into `Moving`.

Commands from `cardano/onchain`:

```sh
aiken check --deny -m containment_current_ --seed 462 --max-success 1
aiken check --deny -m 'host_state_stt.' \
  -m 'spending_tendermint_update_session.' \
  -m 'minting_tendermint_update_session.' \
  -m migration_adversarial -m containment_current_ \
  -m migration_packet_event_log_regression_462 \
  -m transfer_escrow_fails_when_host_state_is_shutting_down \
  -m transfer_burn_voucher_succeeds_when_host_state_is_shutting_down \
  -m on_chan_close_init_given_any_input_returns_false \
  --seed 462 --max-success 100
```

From the repository root and `cardano/offchain`, respectively (Deno 2.9.6):

```sh
python3 scripts/ci/test-migration-guards.py --report .deployment-smoke/containment-guard-controls.json
deno test --allow-env --allow-read --allow-write --filter registry src/migration.test.ts
```

Reports are retained in `.deployment-smoke/containment-regressions.json`, `.deployment-smoke/containment-guard-controls.json`, and `.deployment-smoke/containment-registry-transactions.log`. A public checksum/result index is in [the containment evidence record](evidence/migration-462-containment-result.json). The tests participate in the existing on-chain suite and guard-control CI job; a remote run of this audit commit is not claimed.

The additional guard-removal control changes only a temporary copy of `active_registry`'s phase predicate. Its Ready positive control still passes; the otherwise identical source normal-operation context becomes accepted when the `Moving` guard is removed. This attributes rejection to the intended gate, not an unrelated malformed packet. It is a validator-context negative control, not a claim that this one edit alone creates a reachable ledger exploit after HostState has already moved.
