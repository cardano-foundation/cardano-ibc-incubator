# Emergency containment: implemented baseline

The audit at `73984e8c2` correctly found **no immediate containment**: the only general stop was delayed `Begin`, and anyone could subsequently activate the approved successor. That document described a proposal, not an implemented emergency switch. This candidate implements that switch in the fresh `cardano-ibc-compatible-v3` baseline. Its registry ABI has eight fields, including emergency authority, restriction epoch/mask and a delayed restoration ticket. Earlier seven-field fixtures and rehearsal results are historical evidence, not acceptance of this candidate. There is no live deployment to retrofit.

## Immediate action and authority

The separately configured emergency quorum submits `Restrict(mask)`, spending only the authenticated registry and preserving its address, NFT, value, implementation, governance, proposal, migration progress and all claims. The validator allows only monotonic restriction and increments the emergency epoch. The transaction also revokes any pending permission restoration. A delayed authority-only replacement survives, so compromised emergency keys cannot veto their own removal. It does not require replacement code, a migration proposal or the replacement approval delay. It becomes effective upon canonical inclusion, not when an operator discovers the bug or broadcasts the transaction. Transactions ordered before it can still exploit a vulnerable path; rollback can remove the restriction. Registry contention and unavailable block inclusion are availability limits.

The mask is the union of these bits:

| Bit | Restricted operations | Operations unaffected by this bit |
| --- | --- | --- |
| 1 | All packet sends/receives/returns, acknowledgements, timeouts, refunds/remints, pruning, new topology, port/application changes | Client update/recovery/finalization; heartbeat; registry control |
| 2 | Client update/recovery/finalization; client creation also requires bit 1 clear | Packet operations and heartbeat, unless separately restricted |
| 4 | HostState heartbeat | Other otherwise permitted operations |
| 8 | Begin, every core/root/escrow move, and Activate | Registry restriction/restoration/proposal/cancellation control |

For a transfer/settlement incident, **mask 9** stops traffic and also holds any already approved handover while the successor is reviewed. **Mask 15** additionally stops client maintenance and heartbeat. Setting only mask 1 deliberately allows an already authorized migration to continue. Never exempt refund/redemption merely because it benefits users: a settlement vulnerability can affect those very paths.

| Discovery | Enforced response |
| --- | --- |
| Before any proposal | `Restrict(9)` or `Restrict(15)` immediately restricts upon inclusion; replacement preparation and delayed authorization remain separate. |
| During approval delay | The same transaction preserves the proposal/delay but blocks its execution when bit 8 is set. Governance may cancel before Begin. |
| During migration | Ordinary operations are already frozen by `Moving`. Bit 8 also blocks permissionless moves and activation, including a previously approved unsafe target. No destructive rollback or new target substitution is offered. |

A held partial migration may require delayed restoration to mask 1, completing the exact approved custody handover while traffic remains restricted, then another reviewed generation. This is safe only within the supported wrapper/ABI trust boundary. An approved arbitrary malicious script can ignore wrapper restrictions or steal later; preserving migration outputs does not eliminate replacement-governance trust.

## Restoring service and rotating authority

Emergency and replacement-governance signer sets must be disjoint; deployment fails without explicit valid configuration. The emergency quorum cannot loosen restrictions, approve code, rewrite state or reduce the delay. Governance can propose exact restoration scope and a replacement emergency authority with `ProposeRestoration`. The ticket binds registry nonce, implementation generation, emergency epoch, exact mask, authority and activation/expiry times. `Restore` is permissionless only after the existing governance delay (minimum 24 hours), within expiry, and while every binding still matches. A new restriction, even with the same mask, revokes it. `CancelRestoration` preserves restrictions. Governance rotations must retain separation from the emergency authority.

Governance/code proposal cancellation, expiry, authority rotation and activation do not clear restrictions. Completing a governance rotation revokes any restoration authorized by the outgoing governance, including one proposed during the rotation delay. `ProposeEmergencyRotation` is a distinct governance action available in every phase, including a held partial migration. Its delayed ticket has `mask = None`; `Restore` replaces only the exact approved emergency quorum and preserves the latest mask, implementation and migration progress. Repeated restrictions cannot revoke this ticket or bypass its delay. The nonce/generation/time bindings still apply; its emergency epoch intentionally does not, because tightening permissions is harmless to an authority-only approval. Governance may cancel it; governance rotation revokes it. Ordinary permission restoration has `mask = Some(mask)` and remains epoch-bound and revocable. A lost or compromised emergency quorum can therefore be replaced without granting it veto power, reopening traffic or installing code immediately. Inclusion contention can still delay execution. During `Moving`, phase restrictions take precedence even if emergency bits are clear.

## Enforcement and claims

The registry validator controls restriction, restoration and the handover hold independently of ordinary bridge dispatch. The HostState wrapper checks operation scope before ordinary validation. Client, connection, channel and transfer/escrow wrappers independently authenticate the registry NFT, generation, phase and relevant restriction before invoking ordinary logic. A transaction cannot reference the registry output that it also spends; a confirmed restriction consumes the reference that prebuilt ordinary transactions require. This is on-chain enforcement against direct submitters, not cooperation by Gateway or a relayer.

The original shutdown remains unreachable: HostState rejects `EnterShutdown`/`FinalizeShutdown`; reclaim/burn paths and the off-chain shutdown entrypoint reject the upgradeable profile. Reference cleanup cannot manufacture its required authenticated shutdown state. No backing, packet commitment, acknowledgement, receipt, sequence or refund/remint obligation is erased to implement containment.

Read-only history/proofs and wallet transfers of existing vouchers remain possible. Independent fixed Tendermint session preparation/verification/cancellation does not apply client state and remains possible; applying a completed session requires a permitted client update. A pause preserves recorded claims, not guaranteed deadlines: the counterparty continues, packets can time out and trust periods can expire. Preserve indispensable history and update clients while safe; otherwise recovery depends on the actual supported client's recovery rules.

## Executable checks and limits

`migration_adversarial.test.ak` executes actual registry validation for immediate restriction in every phase, unauthorized relaxation/code substitution, held Begin/escrow moves/activation, restoration delay/revocation and stale bindings. `host_state_stt.test.ak` executes actual upgradeable HostState contexts: blocked send/receive/ack/timeout/prune with positive client/heartbeat controls, plus client and heartbeat restrictions. These are validator contexts, not all balanced ledger transactions.

`migration.test.ts` separately uses real deployment, production builders, compiled scripts, local UPLC evaluation and emulator ledger submission for emergency-only restriction, governance-only restoration proposal, revocation and delayed permissionless restore. Its early-restore attack bypasses builder preflight. `test-migration-guards.py` removes each guard in an isolated source copy: the unchanged valid control passes, and the intended attack changes from rejected to accepted. SDK tests verify that permitted maintenance remains constructible. Exact run provenance belongs in the candidate evidence record; historical populated evidence does not qualify this new ABI.

Containment cannot reverse confirmed theft, freeze remotely held or wallet-held assets, stop the counterparty, automatically repair expired clients, or repair arbitrary immutable policies/proof/session scripts. A path that bypasses every restriction dependency, broken registry/NFT/migration logic, unavailable authority/inclusion, missing necessary history, or malicious approved successors remains outside the guarantee. Full populated current-candidate and real multi-node rollback acceptance remains a release requirement.
