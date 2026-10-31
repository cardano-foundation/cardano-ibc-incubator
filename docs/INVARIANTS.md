# Protocol Invariants And Test Coverage

This document records invariants exercised by the Cardano Aiken suite, compiled
validator tests and the Cosmos-side probabilistic light client. It distinguishes
generated properties, fixed regressions and retained integration evidence. CI
enforces the Aiken property inventory and selected distributions. This catalog
is not a completeness or production-safety claim.

The Cardano-hosted Tendermint client and the Cosmos-hosted Cardano probabilistic
client have different authorization and recovery rules. Their checks are listed
separately below. The probabilistic-client section describes the October 16,
2026 release: v8 `v0.1.8` or v10 `v0.1.5` with shared core `v0.1.6`.
Paths beginning `lib/` or `validators/` are relative to `cardano/onchain`.

## Index

- [Label Kinds And Depths](#label-kinds-and-depths)
- [Composable Fixtures](#composable-fixtures)
- [Client Update, Recovery, And Misbehaviour](#client-update-recovery-and-misbehaviour)
  - [Header Update Transitions](#header-update-transitions)
  - [Connection Delay Anchors](#connection-delay-anchors)
  - [Registered Client Identity And Staged Verification](#registered-client-identity-and-staged-verification)
  - [Authenticated Tendermint Client Upgrades](#authenticated-tendermint-client-upgrades)
  - [HostState Coupling](#hoststate-coupling)
  - [Client Recovery](#client-recovery)
  - [Misbehaviour Detection](#misbehaviour-detection)
  - [Frozen Client Rejection](#frozen-client-rejection)
- [Connection And Channel Handshakes](#connection-and-channel-handshakes)
  - [Connection Open Try](#connection-open-try)
  - [Connection Open Ack](#connection-open-ack)
  - [Channel Handshakes And Close](#channel-handshakes-and-close)
  - [Channel Connection Upgrades](#channel-connection-upgrades)
- [Packet Lifecycle](#packet-lifecycle)
  - [Packet Lanes And Funded Transfers](#packet-lanes-and-funded-transfers)
  - [SendPacket](#sendpacket)
  - [SendPacket Transaction Coupling](#sendpacket-transaction-coupling)
  - [RecvPacket](#recvpacket)
  - [AcknowledgePacket](#acknowledgepacket)
  - [Packet History Pruning](#packet-history-pruning)
  - [TimeoutPacket](#timeoutpacket)
  - [Model Sequences](#model-sequences)
- [Transfer Module Accounting](#transfer-module-accounting)
  - [Module Capability Identity](#module-capability-identity)
  - [Native Token Escrow And Refunds](#native-token-escrow-and-refunds)
  - [Voucher Mint, Burn, And Refunds](#voucher-mint-burn-and-refunds)
  - [Accounting Mutations](#accounting-mutations)
- [Voucher Metadata](#voucher-metadata)
  - [First Mint Canonical Metadata](#first-mint-canonical-metadata)
  - [First Mint Transaction Coupling](#first-mint-transaction-coupling)
  - [Existing Mapping Mint](#existing-mapping-mint)
- [Verifying Proof](#verifying-proof)
  - [Membership Verification](#membership-verification)
  - [Batch Membership Verification](#batch-membership-verification)
  - [Non-Membership Verification](#non-membership-verification)
- [HostState Root Transitions](#hoststate-root-transitions)
  - [Port Binding](#port-binding)
  - [Permissionless Heartbeats](#permissionless-heartbeats)
  - [Client Root Updates](#client-root-updates)
  - [Connection Root Updates](#connection-root-updates)
  - [Channel Root Updates](#channel-root-updates)
  - [Packet Root Updates](#packet-root-updates)
- [Trace Registry Append](#trace-registry-append)
  - [Valid Append Transition](#valid-append-transition)
  - [Append Voucher Mint Coupling](#append-voucher-mint-coupling)
  - [Bucket Correctness](#bucket-correctness)
  - [Active-Shard Duplicate Detection](#active-shard-duplicate-detection)
  - [Archived-Shard Duplicate Detection](#archived-shard-duplicate-detection)
  - [Active Shard Authority](#active-shard-authority)
  - [Bounded Registry Capacity](#bounded-registry-capacity)
- [Trace Registry Rollover](#trace-registry-rollover)
  - [Valid Rollover Transition](#valid-rollover-transition)
  - [Directory Bucket Isolation](#directory-bucket-isolation)
  - [Archived Shard Preservation](#archived-shard-preservation)
  - [New Active Shard Freshness](#new-active-shard-freshness)
  - [Rollover Voucher Mint Coupling](#rollover-voucher-mint-coupling)
  - [Append Rollover Lookup Model](#append-rollover-lookup-model)
- [Shutdown And Compatible Redeployment](#shutdown-and-compatible-redeployment)
- [Commitment And Wire Compatibility](#commitment-and-wire-compatibility)
- [Probabilistic Cardano Client](#probabilistic-cardano-client)
- [Follow-Up Tasks](#follow-up-tasks)
- [Current Coverage Boundary](#current-coverage-boundary)

## Label Kinds And Depths

Fixed regression fixtures run as ordinary unit tests in the smoke suite. They do
not consume deep fuzz iterations or contribute labels to the fuzz coverage gate.
The historical scenario suffixes below remain a description of those regressions;
they are not all mandatory fuzz labels.

Scenario labels include `fuzz.unit.*`, `fuzz.contract.*`, `fuzz.model.*` and
historical `regression.*` labels. Other generated properties compare independent
models directly. A label's name is not evidence of diversity.
CI discovers every property from source, rejects
unused/discarded generated parameters, and compares deep reports with the actual
smoke inventory. Every property must receive the minimum deep execution budget.

Required scenario labels attest execution only. Distribution requirements in
`scripts/ci/aiken-fuzz-required-labels.json` are measured against the iterations of
one named property, never the total labels of unrelated tests. Amount and capacity
buckets are labelled from actual generated values. These checks are not a proof
of semantic coverage, and syntactically using a seed alone does not establish it.

Aiken `ProtocolTxFixture` checks only explicitly invoked handlers. Compiled
transaction coverage comes from the Deno channel, packet-lane, shutdown and
funds suites and the migration jobs. These are dependencies of the stable
`Cardano Onchain Aiken` aggregate when the corresponding CI work runs. The
critical-guard mutation job is also required when Aiken fuzzing runs. The
workflow's change detector and documentation gate determine which work is run
or reused. This does not make every check unconditional on every PR.

## Composable Fixtures

Reusable fuzz fixture plumbing lives in
`cardano/onchain/lib/ibc/testing/fuzz_dsl.ak`. It defines:

- `ModelState` for the protocol area and transition under test.
- `TxFixture` for the collected validator checks for a generated fixture.
- `Mutation` for naming the near-valid mutation applied to a fixture.
- `ExpectedOutcome` for accepted vs rejected fixture expectations.
- `run_all_relevant_validators`, `assert_valid`, and `assert_rejected` helpers.
- `ProtocolTxFixture` for transaction-shaped fixtures with inputs,
  reference inputs, outputs, mint, redeemers, datums, before/after model
  states, mutation metadata, and validator checks.

Properties using this DSL pass valid fixtures through
`valid_check(...).assert_valid` and near-valid mutations through
`mutated_check(...).assert_rejected`. Other properties use direct assertions or
independent model comparisons. The packet SendPacket fixtures use the fuller
composable fixture pattern:

- build a valid `SendPacketFixture` from a model packet;
- pipe it through named mutations such as `mutate_wrong_sequence`;
- run it through `run_send_packet_transition`; and
- assert the expected accept/reject outcome.

Packet receive, acknowledgement, and timeout properties now also use
transition-specific `ProtocolTxFixture` runners:

- `run_recv_packet_transition`
- `run_ack_packet_transition`
- `run_timeout_packet_transition`

Those runners attach concrete channel inputs and outputs with inline datums to
the fixture and collect the validator checks against that transaction shape.
This gives new fuzz targets a common shape without forcing each protocol area
to use the same domain-specific fixture type.

Some validator checks intentionally remain as Aiken `test ... fail` cases.
Those validators abort through hard `expect` failures rather than returning a
Boolean rejection result, and Aiken does not provide a local catch mechanism for
turning that abort into a `TxFixture` check. Generated failure cases participate
in the property inventory. Fixed failure fixtures remain smoke checks. The DSL
covers checks whose validator or model returns an inspectable Boolean.

The original property and regression groups include:

- client update and misbehaviour transition checks in
  `cardano/onchain/lib/ibc/client/ics-007-tendermint-client/client_datum.test.ak`,
  `cardano/onchain/lib/ibc/client/ics-007-tendermint-client/client_state.test.ak`,
  `cardano/onchain/lib/ibc/client/ics-007-tendermint-client/misbehaviour_handle.test.ak`,
  and `cardano/onchain/validators/spending_client.test.ak`;
- connection and channel handshake checks in
  `cardano/onchain/lib/ibc/core/ics-003-connection-semantics/connection_datum.test.ak`,
  `cardano/onchain/lib/ibc/core/ics-003-connection-semantics/connection_handshake_contract.test.ak`,
  and `cardano/onchain/lib/ibc/core/ics-004/channel_datum_test/*.ak`;
- packet lifecycle checks in
  `cardano/onchain/lib/ibc/core/ics-004/channel_datum_test/packet_lifecycle_contract.test.ak`;
- transfer module accounting checks in
  `cardano/onchain/lib/ibc/apps/transfer/transfer_accounting_contract.test.ak`;
- voucher metadata checks in
  `cardano/onchain/lib/ibc/apps/transfer/voucher_metadata_contract.test.ak`
  and validator-level first-seen mint checks in
  `cardano/onchain/validators/minting_voucher.test.ak`;
- verifying-proof membership, non-membership, and batch checks in
  `cardano/onchain/validators/verifying_proof_contract.test.ak`;
- HostState root-transition checks in
  `cardano/onchain/validators/host_state_stt.test.ak`;
- trace-registry append transitions in
  `cardano/onchain/validators/trace_registry.test.ak`;
- trace-registry rollover transitions in
  `cardano/onchain/validators/trace_registry_rollover.test.ak`.

Additional suites cover packet lanes, staged Tendermint verification, upgrades,
shutdown and compatible redeployment. Their sources are listed with the
invariants below. The generated property list comes from
`node scripts/ci/aiken-property-inventory.mjs`, not from this hand-maintained
catalog. Fixed tests and the Go and Deno suites are not counted as generated
Aiken properties.

## Client Update, Recovery, And Misbehaviour

This section concerns clients stored on Cardano, primarily Tendermint clients.
It does not describe the Cosmos-hosted probabilistic client's admission,
observation sessions or governance recovery.

Historical scenario suffixes:

- `unit.client.update.valid_adjacent`
- `unit.client.update.valid_non_adjacent`
- `unit.client.update.invalid_historical_height`
- `contract.client.update.invalid_wrong_host_redeemer`
- `unit.client.update.invalid_wrong_consensus_state`
- `contract.client.update.invalid_missing_host_state`
- `contract.client.recovery.valid_expired`
- `contract.client.recovery.valid_frozen`
- `contract.client.recovery.invalid_missing_authority`
- `unit.client.misbehaviour.valid_same_height_conflict`
- `unit.client.misbehaviour.valid_time_violation`
- `unit.client.misbehaviour.invalid_monotonic_headers`
- `unit.client.misbehaviour.invalid_same_header`
- `unit.client.misbehaviour.invalid_wrong_client_id`
- `unit.client.frozen.rejects_update`

### Header Update Transitions

Covered by `unit.client.update.valid_adjacent`,
`unit.client.update.valid_non_adjacent`,
`unit.client.update.invalid_historical_height`, and
`unit.client.update.invalid_wrong_consensus_state`.

The update properties construct client datum transitions around generated
heights and require `update_state` to accept both adjacent and non-adjacent
header updates. The mutation commits the wrong consensus state for the submitted
header and must be rejected, checking these invariants:

- A valid update can advance to the immediately next height.
- A valid update can advance to a non-adjacent higher height.
- An ordinary update must strictly advance `latest_height`; historical headers
  remain usable as explicit misbehaviour evidence but cannot be inserted into
  the bounded client history.
- The output consensus state must exactly match the submitted header.
- The client latest height must move to the submitted height when the submitted
  height is newer.
- The consensus state and processed metadata named by `latest_height` remain at
  the head of their lists, so bounded truncation cannot evict them independently
  of `latest_height`.

### Connection Delay Anchors

Fixed regressions in `validators/client_delay.test.ak` and
`validators/spending_client_capacity.test.ak` enforce the processing-time anchor:

- Creation and updates record the finite upper validity bound, in nanoseconds,
  and derive processing height from it.
- A backdated lower bound cannot satisfy a nonzero delay immediately after
  processing; real membership and non-membership proofs remain blocked until
  both time and block delays have passed.
- Zero-delay connections remain immediately usable.
- Header verification and history pruning retain their lower-bound time input.

See [Tendermint connection delays](tendermint-connection-delays.md) for the
elapsed-time guarantee and deployment requirements for historical metadata.

### Registered Client Identity And Staged Verification

`lib/ibc/utils/validator_utils.test.ak` and
`lib/ibc/core/ics-002-client-semantics/registry.test.ak` check that registered
client types bind the exact script, datum token, proof policy and canonical
identifier.
Two client types using the same numeric sequence do not share an identity or
commitment namespace. The critical-guard mutants exercise these bindings.

The staged Tendermint implementation is checked by
`lib/ibc/client/ics-007-tendermint-client/multitx/session.test.ak` and
`validators/spending_multitx_client.test.ak`:

- Session tokens bind the verification plan and owner. Validator ordering,
  duplicate rejection and accumulated voting power remain checked across
  batches. A batch contains at most six validators and a set at most 256.
- Intermediate work does not install a new canonical client state. Finalization
  binds the completed session to the live client parameters and authenticated
  trusted consensus history. It records processing time from the finite upper
  validity bound.
- The staged client rejects its direct-update constructor. An incomplete,
  foreign or incorrectly burned session cannot authorize finalization.
- Two authenticated conflicting headers can freeze the client without
  rewriting its consensus history. Fixed regressions check both header orders,
  retained-history conflicts and malformed session/burn combinations.

These Cardano session tokens are distinct from the public Cosmos observation
sessions described under the probabilistic client below.

### Authenticated Tendermint Client Upgrades

`validators/client_upgrade.test.ak` checks the Cardano Tendermint client's
upgrade path. Both replacement client and consensus state require proofs of
the committed upgrade values under the old trusted root. Swapped proofs,
changed paths, forged state, rollback and an expired or frozen client are
rejected. A revision change may reset height. Within one revision height must
advance. Submitter-supplied trust settings cannot change the retained policy.
The temporary upgrade consensus state cannot authorize packet proofs.

This is separate from the Cardano probabilistic client, which intentionally
rejects `MsgUpgradeClient` because it defines no authenticated upgrade
commitment authorizing client-state replacement.

### HostState Coupling

Covered by `contract.client.update.invalid_wrong_host_redeemer` and
`contract.client.update.invalid_missing_host_state`.

The spending-client properties use minimal transactions that fail before
expensive Tendermint verification. They check these invariants:

- A client update must be co-spent with HostState.
- The co-spent HostState must use the `UpdateClient` redeemer branch.
- A different HostState redeemer branch cannot authorize a client update.

### Client Recovery

Covered by `contract.client.recovery.valid_expired`,
`contract.client.recovery.valid_frozen`, and
`contract.client.recovery.invalid_missing_authority`.

The recovery properties exercise the withdrawal validator with an inactive
subject client and a newer active substitute client. They check these
invariants:

- Both expired and frozen subject clients can recover from a compatible active
  substitute.
- Recovery requires the deployment authority recorded in HostState.

### Misbehaviour Detection

Covered by `unit.client.misbehaviour.valid_same_height_conflict`,
`unit.client.misbehaviour.valid_time_violation`,
`unit.client.misbehaviour.invalid_monotonic_headers`,
`unit.client.misbehaviour.invalid_same_header`, and
`unit.client.misbehaviour.invalid_wrong_client_id`.

The misbehaviour properties exercise the detection logic for conflicting
headers and time-order violations. They check these invariants:

- Same-height headers with different block hashes are detected as
  misbehaviour.
- A higher-height header whose timestamp does not increase is detected as
  misbehaviour.
- Monotonic headers are not falsely treated as misbehaviour.
- Re-submitting the same header is not falsely treated as misbehaviour.
- Explicit misbehaviour evidence with a malformed client identifier is
  rejected.
- Each evidence header's height, time, application state, and validator hashes
  must be covered by the block hash authenticated by its commit.
- The validator set used to verify each commit must hash to the validator-set
  commitment in that same header. Detached header fields or a mismatched set
  cannot freeze the client.

### Frozen Client Rejection

Covered by `unit.client.frozen.rejects_update`.

The frozen-client property constructs a non-zero frozen height and checks that
client status is `Frozen`. Since the spending client validator requires
`Active` status before accepting updates, this checks that a frozen client is
not updateable.

## Connection And Channel Handshakes

Historical scenario suffixes:

- `unit.conn.open_try.valid`
- `unit.conn.open_try.invalid_missing_client_proof`
- `tx.conn.open_try.valid_full_transition`
- `tx.conn.open_try.invalid_wrong_client_state_proof`
- `unit.conn.open_try.invalid_wrong_host_redeemer`
- `unit.conn.open_ack.valid`
- `unit.conn.open_ack.invalid_wrong_proof_height`
- `contract.chan.open_ack.valid`
- `contract.chan.open_confirm.valid`
- `contract.chan.close_init.valid_or_rejected_by_app_policy`
- `contract.chan.close_confirm.valid`
- `unit.chan.closed.rejects_send`
- `model.channel.open_close_reject_send`

### Connection Open Try

Covered by `unit.conn.open_try.valid`,
`unit.conn.open_try.invalid_missing_client_proof`,
`tx.conn.open_try.valid_full_transition`,
`tx.conn.open_try.invalid_wrong_client_state_proof`, and
`unit.conn.open_try.invalid_wrong_host_redeemer`.

The valid unit property exercises the pure connection datum transition for a
TryOpen connection. The tx-level ConnOpenTry properties build a
near-valid ConnOpenTry transaction and runs the connection minting validator,
HostState CreateConnection validator, and connection datum transition against
the same fixture. The invalid tx property mutates only the counterparty
client-state proof value. The remaining proof-shape and HostState-redeemer properties are
smoke/regression checks for narrow redeemer gates. Together they check these
invariants:

- A ConnOpenTry output datum must be in `TryOpen` state and carry the minted
  connection token.
- ConnOpenTry proof authorization must include both the counterparty
  connection proof and the counterparty client-state proof.
- The counterparty client-state bytes in the proof redeemer must match the
  requested counterparty client state in the actual ConnOpenTry minting gate.
- Minting a connection token for ConnOpenTry must be coupled to the
  `CreateConnection` HostState redeemer branch.

### Connection Open Ack

Covered by `unit.conn.open_ack.valid` and
`unit.conn.open_ack.invalid_wrong_proof_height`.

The valid property exercises the pure connection datum transition from Init to
Open with a concrete counterparty connection identifier. The proof-height
unit property checks that an OpenAck proof redeemer cannot silently use a
different proof height. These properties check these invariants:

- ConnOpenAck must move a connection from `Init` to `Open`.
- ConnOpenAck must set the counterparty connection id while preserving the
  other committed connection fields.
- ConnOpenAck proof authorization is tied to the requested proof height.

### Channel Handshakes And Close

Covered by `contract.chan.open_ack.valid`, `contract.chan.open_confirm.valid`,
`contract.chan.close_init.valid_or_rejected_by_app_policy`,
`contract.chan.close_confirm.valid`, and `unit.chan.closed.rejects_send`.

The channel properties exercise the shared channel datum transition functions
for OpenAck, OpenConfirm, CloseInit, and CloseConfirm. The closed-channel
property covers the local send-packet open-channel predicate. They check these
invariants:

- ChanOpenAck must move a channel from `Init` to `Open` and commit the
  counterparty channel id.
- A bounded open-close model can move `Init -> Open -> Closed`.
- Once the model reaches `Closed`, the send-packet open-channel gate rejects
  further sends.
- ChanOpenConfirm must move a channel from `TryOpen` to `Open`.
- ChanCloseInit must close an open channel at the core datum layer, while app
  policy may still reject the close path before this transition is accepted.
- ChanCloseConfirm must close an open channel.
- A closed channel does not satisfy the send-packet open-channel gate.

The fixed regressions in
`validators/spending_channel/transfer_close_confirm.test.ak` additionally run
the transfer callback, close-confirm mint policy, channel spending validator,
HostState update, and ICS-23 proof verifier on the same transaction. They check:

- An authenticated proof of a closed counterparty channel permits local
  ICS-20 close-confirm and commits the closed channel end in HostState.
- A proof of an open counterparty channel, an invalid proof, or an absent or
  malformed close-confirm marker cannot authorize closure.
- The callback requires the exact channel token, close-confirm spend
  redeemer, and successor for this port. That spend requires the mint policy
  to bind the registered callback and closed continuation, preserving the
  remaining channel datum.
- The transfer module root retains its address, capability tokens, datum, and
  non-ADA assets; ADA can only stay constant or increase for minimum-UTxO needs.
- Escrow shards cannot be spent using a channel close callback, and transfer
  close-init remains rejected even with a valid channel context.

The off-chain deployment test checks that close-confirm exposes a mint handler
in the compiled blueprint. Gateway close-confirm builder tests cover both mock
and transfer modules and require their original datum and full value to survive.

### Channel Connection Upgrades

`validators/spending_channel/chan_upgrade.test.ak` and Gateway's
`cardano/gateway/src/tx/test/channel-upgrade.service.spec.ts` cover the
connection-replacement protocol described in [channel upgrades](channel-upgrades.md):

- The deployment authority proposes the replacement connection. Ordering,
  version and channel identity remain fixed. Ordinary steps authenticate
  counterparty state through the current connection.
- Flushing stops sends and records the exact send-sequencer boundary.
  Completion certifies every drained packet lane and rechecks the replacement
  client and counterparty deadline. In-flight commitments or missing lanes
  prevent completion.
- OPEN requires the counterparty to have opened on its replacement connection.
  The new receive floor rejects packets settled before handover. A partially
  completed handover can finish after its recorded deadline.
- Cancellation and timeout advance error receipts monotonically.
  A closed channel cannot be reopened. Upgrade transactions cannot move escrow,
  vouchers or unrelated script state.

The supported counterparty is ibc-go v8. The v10 adapter rejects channel-upgrade
proofs. These tests do not close the composed live migration gate documented
in the channel-upgrade runbook.

## Packet Lifecycle

The Gateway's transfer RPCs use packet lanes. The older channel-datum handlers
remain for other packet paths and regression fixtures. Their 64-entry bound
and HostState co-spend requirements below describe that channel-datum path,
not the lane-based transfer path.

### Packet Lanes And Funded Transfers

The lane helpers in `lib/ibc/core/ics-004/packet_lanes.test.ak`,
`packet_lane_datum.test.ak` and `packet_lane_state.test.ak` check:

- The lane count is fixed between 1 and 64. Canonical port/channel identity and
  `sequence % lane_count` determine the lane. Invalid identifiers, zero
  sequences and overflow are rejected.
- Every lane transition consumes its authenticated token and creates one exact
  continuation. It preserves identity, verifies sequential Merkle witnesses
  and increments the lane version once per spent output.
- Each lane retains at most 64 outstanding commitments in its datum. Receipts
  and acknowledgements stay in the authenticated tree permanently. They do not
  consume live datum capacity. Authenticated non-membership prevents duplicate
  receives and no lane mutation can delete a receipt or acknowledgement. The
  proof-height slots remain in the datum for Go decoder compatibility.
- Balance maps have at most eight asset entries. Compaction conserves each
  asset's combined obligation across two authenticated lanes without changing
  packet roots. It cannot replace packet execution or bypass pending refunds.

`cardano/offchain/src/packet-lane-transactions.test.ts` executes compiled
validators through the shared transaction builders. Its fixtures cover funded
intent admission and cancellation, batched sends, independent lane settlement,
same-lane sequential witnesses, stale completion rebuilding, rollback reload,
native returns, voucher mint/refund and timeout-on-close. Repeated multi-asset
round trips check accounting reclamation at capacity.

Normal lane packet transactions do not spend HostState or the channel datum.
Their packet policies still authenticate the channel, client, callback and
counterparty proofs. Send sequencing is a separate authenticated output.
The destination snapshot engine verifies tracked lane continuations before
exposing packet roots. Go regressions in
`cosmos/cardano-probabilistic-light-client-core/packet_lane_commitment_test.go`
reject malformed identities, changed layouts and superseded outputs.

Historical scenario suffixes:

- `unit.packet.send.valid`
- `unit.packet.send.invalid_wrong_sequence`
- `unit.packet.send.invalid_missing_commitment_root_update`
- `unit.packet.send.invalid_wrong_transfer_callback`
- `unit.packet.send.invalid_commitment_capacity`
- `unit.packet.recv.valid_receipt`
- `unit.packet.recv.invalid_duplicate_receipt`
- `unit.packet.recv.invalid_history_capacity`
- `unit.packet.ack.valid_success`
- `unit.packet.ack.valid_error`
- `unit.packet.ack.invalid_wrong_ack_bytes`
- `unit.packet.timeout.valid_unordered`
- `unit.packet.timeout.valid_ordered`
- `unit.packet.timeout.invalid_before_timeout`
- `tx.packet.send.valid_channel_host_marker`
- `tx.packet.send.invalid_missing_operation_marker`
- `contract.packet.recv.valid_atomic_successor_callback`
- `contract.packet.recv.invalid_missing_application_callback`
- `contract.packet.recv.invalid_moved_port_binding`
- `contract.packet.recv.invalid_unrelated_successor_mutation`
- `contract.packet.recv.invalid_callback_packet_data`
- `contract.packet.recv.invalid_callback_acknowledgement`
- `contract.packet.recv.valid_sink_mints_voucher`
- `model.packet.send_ack.valid_sequence`
- `model.packet.send_recv_ack`
- `model.packet.send_timeout`

### SendPacket

This subsection and the following channel-datum fixtures describe the retained
HostState-coupled path. Lane-based transfers are covered separately above.

Covered by `unit.packet.send.valid`, `unit.packet.send.invalid_wrong_sequence`,
`unit.packet.send.invalid_missing_commitment_root_update`, and
`unit.packet.send.invalid_wrong_transfer_callback`, with the collection bound
covered by `unit.packet.send.invalid_commitment_capacity`, plus the composed
`spending_channel/send_packet.test.ak` callback-atomicity cases.

The SendPacket unit properties build a valid open-channel channel-datum
packet-send transition and then mutate exactly one field per negative case.
They do not run the full composed packet transaction. They check these
invariants:

- A valid send increments `next_sequence_send` and inserts the exact packet
  commitment under the packet sequence.
- The packet sequence must equal the channel datum's current
  `next_sequence_send`.
- The packet commitment datum effect cannot be omitted while the sequence is
  advanced.
- The transfer callback/channel redeemer must refer to the same packet bytes;
  a callback for a different transfer payload is rejected.
- The registered port-token UTxO must be spent, or referenced while exactly one
  UTxO at its immutable module script credential is spent.
- The typed `OnSendPacket` callback must match the source channel, raw packet
  bytes, and packet commitment exactly.
- A callback whose typed ICS-20 data disagrees with the packet bytes is rejected
  by the transfer-module validator in the same composed transaction.
- A channel may retain at most 64 entries total across packet commitments,
  receipts, and acknowledgements. A send may fill the final remaining entry;
  another insertion is rejected before the datum is enlarged.

### SendPacket Transaction Coupling

Covered by `tx.packet.send.valid_channel_host_marker`,
`tx.packet.send.invalid_missing_operation_marker`, and the composed outbound
callback tests in `spending_channel/send_packet.test.ak`.

The transaction-level SendPacket property runs the real `spending_channel`
validator against a transaction-shaped fixture. The fixture includes the
channel input and continuation output, module co-spend redeemer, HostState
`HandlePacket` redeemer, SendPacket operation marker mint, connection and
client reference inputs, and the packet commitment update. It checks these
invariants:

- A SendPacket channel spend must be coupled to the HostState packet branch.
- A SendPacket channel spend must mint exactly the SendPacket operation marker.
- A SendPacket channel spend without the operation marker redeemer/mint is
  rejected by the real channel validator.
- The operation marker redeemer must carry the channel auth token.
- The channel continuation output must preserve the channel thread token while
  recording the packet commitment.
- The send-packet spend branch, send-packet mint branch, channel wrapper,
  transfer-module validator, and first-shard minting policy accept one atomic
  native send fixture together.
- Omitting the registered module, using an untyped callback, changing the
  callback channel/packet bytes/digest, or changing only the typed ICS-20
  amount is rejected.
- Existing escrow shards are accepted only when their payment script
  credential matches the credential anchored by the registered port-token
  reference input.

The HostState root-transition validator remains covered separately because its
fixture requires the full sparse-Merkle witness. The outbound native-send
fixture does run the marker, channel, transfer-module, and escrow-shard policy
checks over the same transaction, including exact escrow accounting.

### RecvPacket

Covered by `unit.packet.recv.valid_receipt`,
`unit.packet.recv.invalid_duplicate_receipt`, and the `contract.packet.recv.*`
receive-transition labels listed above, with the collection bound covered by
`unit.packet.recv.invalid_history_capacity`. Sink-chain voucher mint coupling
is additionally covered by `contract.packet.recv.valid_sink_mints_voucher`. The real
receive policy's timeout boundary is covered by `succeed_recv_packet`,
`recv_packet_rejects_height_only_timeout`, and
`recv_packet_rejects_mixed_height_and_timestamp_timeout`.

The RecvPacket unit properties construct an unordered channel-datum receive
transition that writes the receipt and acknowledgement commitment, then mutate
the input datum to already contain the receipt. They check these invariants:

- A valid unordered receive records a receipt for the packet sequence.
- A valid receive records the acknowledgement commitment for the packet
  sequence.
- A packet cannot be received again if its receipt already exists.
- A packet cannot be received again if its acknowledgement already exists.
- A successful receive must atomically commit the unique canonical successor
  for that packet and an authenticated callback from the module registered to
  the destination port.
- The callback must carry the exact packet bytes and acknowledgement whose
  commitment is written to channel state.
- A root-module callback must preserve the registered port token at the same
  script address; a shard callback must be anchored to that immutable root.
- Missing callbacks, unrelated channel mutations, moved port bindings, and
  callback packet or acknowledgement mismatches are rejected.
- A receive must use a zero timeout height because Cardano block height is not
  authenticated in the transaction context; height-only and mixed timeouts
  therefore fail closed.
- A receive must use a nonzero timeout timestamp, and the transaction validity
  interval must end strictly before that timestamp.
- Each channel may retain at most 64 entries total across packet commitments,
  receipts, and acknowledgements. An unordered receive may fill the final two
  remaining entries; the next receive fails closed before permanent history
  can make the channel datum too large for the ledger.
- A sink-chain RecvPacket voucher mint can be coupled to the trace-registry
  append that proves the new voucher denom trace.

The atomic receive transaction fixture executes the real receive marker policy
and HostState validator over the same inputs, outputs, and redeemers. This
checks that both validators accept one canonical transition rather than merely
accepting independently constructed states.

### AcknowledgePacket

Covered by `unit.packet.ack.valid_success`, `unit.packet.ack.valid_error`, and
`unit.packet.ack.invalid_wrong_ack_bytes`, together with the registered-root
and escrow-shard callback cases in
`spending_channel/acknowledge_packet.test.ak`.

The acknowledgement unit properties construct a near-valid source-side channel
datum packet commitment and apply success and error acknowledgement bytes. They
check these invariants:

- A valid acknowledgement consumes the packet commitment.
- Success acknowledgement bytes must be the canonical marshalled acknowledgement
  payload.
- Error acknowledgement bytes must be the canonical marshalled acknowledgement
  payload.
- Mismatched acknowledgement bytes are rejected even when the channel datum
  transition is otherwise valid.

- Packet commitment deletion requires a typed callback authorized by the port
  token registered for the source port.
- Voucher callbacks spend and preserve the registered module root. Native
  refund callbacks may instead spend an escrow shard only when the root is a
  reference input and the shard uses the root's immutable script credential.
- The callback channel, raw packet bytes, and canonical acknowledgement bytes
  must match the channel redeemer exactly. Consequently a relayer cannot prove
  an error acknowledgement while presenting a success callback to bypass the
  refund branch, or vice versa.
- Missing and mismatched callbacks are rejected for both voucher-remint and
  native-unescrow witness shapes before the packet commitment can be removed.

### Packet History Pruning

This section covers the legacy inline channel format used by other application
ports. ICS-20 packet lanes retain history permanently and expose no pruning
operation.

Covered by the deterministic
`channel_datum_test/validate_prune_packet_history.ak`,
`spending_channel/prune_packet_history.test.ak`, and HostState prune-root
fixtures. The `spending_channel/prune_packet_history_contract.test.ak`
regression executes the prune marker, channel, HostState, and proof validators
against one shared transaction.

The cleanup transition checks these invariants:

- Packet history remains authoritative on-chain; Gateway or relayer state is
  not needed to recover the live IBC state root.
- Only finalized destination history can be removed, and the corresponding
  source commitment must be proven absent at an authenticated counterparty
  height. Unordered channels remove the receipt and acknowledgement for the
  same sequence; ordered channels remove only the acknowledgement and require
  that the sequence is below `next_sequence_recv`.
- The prune height cannot precede either the existing replay floor or the
  greatest proof height accepted by any receive on the channel.
- Pruning advances the replay floor atomically with the ordering-specific
  Merkle-leaf deletion, so a packet-membership proof from an older height cannot
  replay the receive. Ordered replay is independently prevented by the
  unchanged monotonic `next_sequence_recv` counter.
- Ordinary unordered receives may still arrive out of proof-height order above
  the replay floor; the receive high-water mark never becomes a receive-ordering
  requirement.
- Unordered receipt deletion is applied before acknowledgement deletion and
  both sparse-Merkle witnesses must produce the exact successor HostState root.
  Ordered pruning preserves the receipt root and supplies only the
  acknowledgement-deletion witness.
- No packet commitment or unrelated channel field may change during cleanup,
  and pruning remains executable when the channel datum is at its 64-entry
  bound.

### TimeoutPacket

Covered by `unit.packet.timeout.valid_unordered`,
`unit.packet.timeout.valid_ordered`, and
`unit.packet.timeout.invalid_before_timeout`, together with the registered-root
and escrow-shard callback cases in
`spending_channel/timeout_packet.test.ak`.

The timeout unit properties construct committed channel datum packets and apply
unordered and ordered timeout transitions. They check these invariants:

- A valid unordered timeout consumes the packet commitment and keeps the channel
  open.
- A valid ordered timeout consumes the packet commitment and closes the channel.
- A timeout cannot execute before the packet timeout timestamp has been reached.
- A timeout cannot consume the packet commitment unless the registered
  application callback for the exact channel and packet bytes is executed in
  the same transaction.
- Both voucher-remint root callbacks and native-unescrow shard callbacks reject
  omitted or mismatched refund witnesses.

### Model Sequences

Covered by `model.packet.send_ack.valid_sequence`,
`model.packet.send_recv_ack`, and `model.packet.send_timeout`.

The model properties construct explicit bounded packet lifecycle state
sequences:

- initial open channel -> SendPacket output state -> AcknowledgePacket output
  state;
- initial open channel -> SendPacket output state -> RecvPacket output state ->
  AcknowledgePacket output state; and
- initial open channel -> SendPacket output state -> TimeoutPacket output state.

They run each step against the relevant channel datum transition helper and
then assert the final modeled state. They check these invariants:

- A packet accepted by the send transition can be consumed by the ack
  transition using the send output as the next model input.
- A send output can also be the starting state for a receive of an independent
  inbound packet before the original outbound packet is acknowledged.
- The receive step records both receipt and acknowledgement commitments for the
  inbound packet sequence.
- A send output can be consumed by a mature timeout transition.
- The timeout sequence removes the outbound packet commitment and keeps an
  unordered channel open.
- The final model state removes the packet commitment.
- The final model state preserves the incremented send sequence from the first
  step.

## Transfer Module Accounting

This section catalogs the module-root and escrow-shard callback fixtures.
Lane-funded intents, deposit liquidity and lane balance accounting are covered
under [packet lanes and funded transfers](#packet-lanes-and-funded-transfers).

Historical scenario suffixes:

- `unit.transfer.native_send.escrow_increases_exactly`
- `unit.transfer.native_timeout.refund_exactly`
- `unit.transfer.native_ack.no_refund`
- `unit.transfer.voucher_send.burns_exactly`
- `unit.transfer.voucher_error_ack.remints_exactly`
- `unit.transfer.recv_source.unescrows_exactly`
- `unit.transfer.recv_sink.mints_voucher_exactly`
- `unit.transfer.invalid_extra_voucher_mint_rejected`
- `unit.transfer.invalid_wrong_escrow_delta_rejected`
- `unit.transfer.invalid_wrong_native_refund_amount_rejected`
- `unit.transfer.invalid_wrong_voucher_burn_amount_rejected`
- `unit.transfer.invalid_wrong_escrow_shard_rejected`
- `unit.transfer.invalid_receiver_address_rejected`
- `contract.transfer.native_send.escrow_increases_exactly`
- `contract.transfer.native_timeout.refund_exactly`
- `contract.transfer.native_ack.no_refund`
- `contract.transfer.voucher_send.burns_exactly`
- `contract.transfer.voucher_error_ack.remints_exactly`
- `contract.transfer.recv_source.unescrows_exactly`
- `contract.transfer.recv_sink.mints_voucher_exactly`
- `contract.transfer.invalid_capability_relocation`
- `contract.transfer.invalid_wrong_escrow_delta_rejected`
- `contract.transfer.invalid_wrong_native_refund_amount_rejected`

### Module Capability Identity

Covered by `contract.transfer.invalid_capability_relocation` and the focused
wrong-credential and incomplete-capability-set tests in
`cardano/onchain/lib/ibc/utils/validator_utils.test.ak`.

During ordinary packet operations, a bound port's module authority is fixed.
HostState records the registered script credential, port token and module token.
Callback discovery accepts only that capability pair at that credential.
A transfer root transition preserves both tokens at the original full address. A
public callback can therefore neither relocate the root to an attacker script
nor substitute an unrelated UTxO that merely carries the derived port token.
An authorized compatible redeployment changes the implementation through its
separate authenticated handover and commitment update.

### Native Token Escrow And Refunds

Covered by `unit.transfer.native_send.escrow_increases_exactly`,
`unit.transfer.native_timeout.refund_exactly`,
`unit.transfer.native_ack.no_refund`,
`unit.transfer.recv_source.unescrows_exactly`,
`contract.transfer.native_send.escrow_increases_exactly`,
`contract.transfer.native_timeout.refund_exactly`,
`contract.transfer.native_ack.no_refund`, and
`contract.transfer.recv_source.unescrows_exactly`.

The native-token accounting properties now have two layers. The helper-level
properties check exact value deltas for small focused accounting fixtures. The
validator-level properties build full `spending_transfer_module` transactions
with the channel redeemer, module callback or operator redeemer, HostState
co-spend, operation-specific voucher or escrow-shard redeemer, and escrow shard
inputs/outputs where the transition requires them. They check these invariants:

- A native send must increase the matching escrow shard by exactly the transfer
  amount.
- A native timeout refund must reduce escrow by exactly the transfer amount and
  increase the original sender balance by exactly the transfer amount.
- A successful native acknowledgement must not change module value, refund the
  sender, or mint vouchers.
- Receiving a packet back on the source chain must unescrow exactly the packet
  amount to the Cardano receiver.
- Escrow-shard token names hash a domain-separated, length-framed channel ID
  and denomination, so moving bytes across the field boundary cannot alias two
  different shard identities.
- First creation consumes the transfer-module root and proves an
  absent-to-registered update against its fixed-size escrow-shard registry
  root; the same `{channel_id, denom}` therefore cannot mint a second NFT.
- Registry membership is permanent. A shard whose non-ADA escrow balance
  reaches zero keeps its datum and NFT, and a later send reuses that UTxO
  without changing the registry root.
- Gateway and reusable runtime lookup rebuild the registry from every shard at
  the module address and reject malformed holders, duplicates, path
  collisions, or a root mismatch instead of treating lookup failures as
  absence.

Permanent membership means a deployment retains one shard UTxO for every
observed `{channel_id, denom}` pair; this bounded-per-pair state cost is the
tradeoff that makes creation non-replayable without growing the module datum.

### Voucher Mint, Burn, And Refunds

Covered by `unit.transfer.voucher_send.burns_exactly`,
`unit.transfer.voucher_error_ack.remints_exactly`,
`unit.transfer.recv_sink.mints_voucher_exactly`,
`contract.transfer.voucher_send.burns_exactly`,
`contract.transfer.voucher_error_ack.remints_exactly`, and
`contract.transfer.recv_sink.mints_voucher_exactly`.

The voucher accounting properties also have two layers. The helper-level
properties check exact voucher-policy mint or burn values. The validator-level
properties build full `spending_transfer_module` transactions for voucher send,
sink-chain receive, and error acknowledgement refund paths, including the
channel packet redeemer, module redeemer, HostState co-spend, and voucher policy
redeemer expected by the module validator. They check these invariants:

- Sending vouchers from a sink chain must burn exactly the packet amount.
- Error acknowledgements for sink-chain voucher sends must remint exactly the
  packet amount.
- Receiving a packet on the sink chain must mint exactly the packet amount of
  the canonical voucher asset.
- Voucher accounting cannot hide supply changes in the module state output.

### Accounting Mutations

Covered by `unit.transfer.invalid_extra_voucher_mint_rejected`,
`unit.transfer.invalid_wrong_escrow_delta_rejected`,
`unit.transfer.invalid_wrong_native_refund_amount_rejected`,
`unit.transfer.invalid_wrong_voucher_burn_amount_rejected`,
`unit.transfer.invalid_wrong_escrow_shard_rejected`,
`unit.transfer.invalid_receiver_address_rejected`,
`contract.transfer.invalid_wrong_escrow_delta_rejected`,
and `contract.transfer.invalid_wrong_native_refund_amount_rejected`.

The mutation properties add one malicious difference to otherwise near-valid
accounting fixtures. The full validator-level mutations currently cover wrong
send escrow deltas and wrong native-token timeout refund amounts; the remaining
mutation labels are helper-level accounting checks. Together, they check these
invariants:

- A transaction that mints any extra voucher-policy asset beyond the expected
  voucher amount is rejected.
- A native send whose escrow shard increases by less than the packet amount is
  rejected.
- A native refund/unescrow whose escrow shard decreases by less than the packet
  amount is rejected.
- A voucher send whose burn amount is smaller than the packet amount is
  rejected.
- A native escrow update must spend the shard whose datum matches the expected
  `{channel_id, denom}`.
- Receiver addresses used for native unescrow/refund accounting must decode to
  a valid Cardano verification key hash.

## Voucher Metadata

Historical scenario suffixes:

- `unit.voucher.first_mint.valid_metadata`
- `unit.voucher.first_mint.invalid_wrong_name`
- `unit.voucher.first_mint.invalid_wrong_ticker`
- `unit.voucher.first_mint.invalid_wrong_description`
- `unit.voucher.first_mint.invalid_wrong_full_denom`
- `unit.voucher.first_mint.invalid_wrong_policy`
- `unit.voucher.first_mint.invalid_wrong_reference_asset`
- `unit.voucher.existing_mint.rejects_reference_nft`
- `contract.voucher.first_mint.valid_metadata`
- `contract.voucher.first_mint.invalid_wrong_name`
- `contract.voucher.first_mint.invalid_wrong_ticker`
- `contract.voucher.first_mint.invalid_wrong_description`
- `contract.voucher.first_mint.invalid_wrong_full_denom`
- `contract.voucher.first_mint.invalid_wrong_policy`
- `contract.voucher.first_mint.invalid_wrong_reference_asset`
- `tx.voucher.first_mint.valid_registry_coupled`
- `tx.voucher.first_mint.invalid_wrong_metadata_registry_coupled`

### First Mint Canonical Metadata

Covered by `unit.voucher.first_mint.valid_metadata`,
`unit.voucher.first_mint.invalid_wrong_name`,
`unit.voucher.first_mint.invalid_wrong_ticker`,
`unit.voucher.first_mint.invalid_wrong_description`,
`unit.voucher.first_mint.invalid_wrong_full_denom`,
`unit.voucher.first_mint.invalid_wrong_policy`,
`unit.voucher.first_mint.invalid_wrong_reference_asset`,
`contract.voucher.first_mint.valid_metadata`,
`contract.voucher.first_mint.invalid_wrong_name`,
`contract.voucher.first_mint.invalid_wrong_ticker`,
`contract.voucher.first_mint.invalid_wrong_description`,
`contract.voucher.first_mint.invalid_wrong_full_denom`,
`contract.voucher.first_mint.invalid_wrong_policy`, and
`contract.voucher.first_mint.invalid_wrong_reference_asset`.

The first-mint metadata properties now have two layers. The small library tests
compare candidate metadata against the same canonical
`voucher_metadata.build_datum` value used by the minting validator. The
validator-level properties build a first-seen voucher mint transaction with a
matching trace-registry shard update, channel callback, reference NFT output,
and CIP-68 metadata datum, then run the real `minting_voucher` policy. Each
invalid validator property mutates one metadata or reference-asset component.
They check these invariants:

- The display `name` must be derived from the base denomination.
- The display `ticker` must be derived from the base denomination.
- The display `description` must include the exact full denom trace.
- The non-display `fullDenom` field must match the trace-registry full denom.
- The embedded voucher policy id must match the voucher minting policy.
- The metadata output must carry the canonical CIP-67 reference NFT for the
  same denom hash.
- Human-readable metadata cannot claim a different denom, policy, or display
  identity than the voucher asset it describes.

### First Mint Transaction Coupling

Covered by `tx.voucher.first_mint.valid_registry_coupled`,
`contract.packet.recv.valid_sink_mints_voucher`, and
`tx.voucher.first_mint.invalid_wrong_metadata_registry_coupled`.

The transaction-level property builds the first-seen voucher mint transaction
with the voucher output, reference NFT metadata output, active trace shard input
and output, trace directory reference input, channel packet redeemer, transfer
module callback redeemer, and trace-registry redeemer. It then runs both the
`minting_voucher` policy and the `trace_registry` spend validator against that
same transaction fixture. It checks these invariants:

- The first voucher mint and trace-registry append are accepted together for
  the same full denom.
- The trace registry update commits the same voucher hash and full denom that
  the voucher policy checks.
- The transaction fixture contains the registry output that the registry
  validator requires, rather than only carrying a witness redeemer for the mint
  policy.
- A first-seen voucher mint with a valid trace-registry append but wrong
  human-readable CIP-68 metadata is rejected by the voucher policy in the same
  transaction fixture.

### Existing Mapping Mint

Covered by `unit.voucher.existing_mint.rejects_reference_nft`,
`minting_voucher.test.test_refund_voucher`, and
`minting_voucher.test.test_refund_voucher_fails_with_wrong_metadata_mapping`.

The existing-mapping property constructs the mint value for an already-registered
voucher mapping and mutates it by adding a reference NFT. It checks this
invariant:

- Existing voucher mappings may mint only the user voucher asset; reference NFT
  creation is reserved for first-seen mappings.
- A repeated mint or refund must reference exactly one immutable CIP-68
  reference NFT whose token name, script address, and canonical datum match the
  voucher hash and full denom.
- Existing mapping proofs do not depend on the trace-registry directory or its
  archived shards, so later registry admission exhaustion cannot strand
  existing voucher funds.

## Verifying Proof

Historical scenario suffixes:

- `contract.proof.membership.valid`
- `contract.proof.membership.invalid_wrong_path`
- `contract.proof.membership.invalid_wrong_value`
- `contract.proof.membership.invalid_wrong_root`
- `contract.proof.batch.valid_two_items`
- `contract.proof.batch.invalid_item_swapped`
- `contract.proof.batch.invalid_extra_item`
- `contract.proof.batch.invalid_missing_item`
- `contract.proof.nonmembership.valid`
- `contract.proof.nonmembership.invalid_existing_key`

### Membership Verification

Covered by `contract.proof.membership.valid`,
`contract.proof.membership.invalid_wrong_path`,
`contract.proof.membership.invalid_wrong_value`, and
`contract.proof.membership.invalid_wrong_root`.

The membership properties use a real two-level ICS-23 proof accepted by the
`verifying_proof` minting validator, then mutate exactly one proof argument.
They check these invariants:

- A valid membership proof mints the proof marker only for the exact committed
  path, value, and consensus root.
- The proof path cannot be changed while reusing the same proof payload.
- The committed value cannot be changed while reusing the same proof payload.
- The consensus state root cannot be changed while reusing the same proof
  payload.

### Batch Membership Verification

Covered by `contract.proof.batch.valid_two_items`,
`contract.proof.batch.invalid_item_swapped`,
`contract.proof.batch.invalid_extra_item`, and
`contract.proof.batch.invalid_missing_item`.

The batch properties require the proof validator to verify each submitted item
and reject a vacuous empty batch. They check these invariants:

- A batch with two valid membership items is accepted.
- A batch fails when any item binds the proof to the wrong path.
- A batch fails when an extra submitted item is not itself a valid membership
  proof.
- An empty batch cannot mint a proof marker.

### Non-Membership Verification

Covered by `contract.proof.nonmembership.valid` and
`contract.proof.nonmembership.invalid_existing_key`.

The non-membership properties use a real ICS-23 non-existence proof for a
packet receipt path, then mutate the requested path to an existing neighboring
key from the proof. They check these invariants:

- A valid non-membership proof mints the proof marker for the absent key.
- A non-membership proof cannot be reused to prove absence of an existing key.

## HostState Root Transitions

Historical scenario suffixes:

- `contract.host.bind_port.invalid_unauthorized`
- `unit.host.bind_port.invalid_capacity`
- `unit.host.bind_port.invalid_identifier`
- `contract.host.update_client.valid`
- `contract.host.update_client.invalid_wrong_root`
- `contract.host.update_client.invalid_wrong_redeemer`
- `contract.host.update_connection.valid`
- `contract.host.update_connection.invalid_uncommitted_connection_change`
- `contract.host.update_channel.valid`
- `contract.host.update_channel.invalid_packet_field_change`
- `contract.host.update_channel.invalid_receive_height_mutation`
- `contract.host.handle_packet.valid_send`
- `contract.host.handle_packet.valid_recv`
- `contract.host.handle_packet.valid_ack`
- `contract.host.handle_packet.valid_timeout`
- `contract.host.handle_packet.invalid_channel_only_change`
- `contract.host.handle_packet.invalid_recv_channel_mutation`
- `contract.host.handle_packet.invalid_commitment_capacity`
- `contract.host.handle_packet.invalid_history_capacity`
- `contract.host.handle_packet.invalid_ack_capacity`
- `contract.host.handle_packet.invalid_wrong_packet_key`

### Port Binding

Covered by `contract.host.bind_port.invalid_unauthorized`,
`unit.host.bind_port.invalid_capacity`, and
`unit.host.bind_port.invalid_identifier`, with deterministic boundary fixtures
for the tenth HostState port and tenth module capability token.

Port registration checks these invariants:

- Only the deployment authority recorded in HostState may register a port.
- The singleton HostState can retain at most ten permanent port registrations.
- Port numbers are non-negative and fit the at-most-eight-byte decimal postfix
  used by the capability-token naming scheme.
- A legitimate tenth registration remains executable within the ledger size
  and execution-unit budgets enforced by CI.

### Permissionless Heartbeats

Fixed regressions in `validators/host_state_stt.test.ak` check root-preserving
heartbeats, independent relayer authorization, missing clock rejection and
shutdown restrictions. Wire-version-5 heartbeats preserve the IBC root and
counters. A funded payment-key signer need not be the deployment authority.
The dedicated ledger-bound heartbeat clock enforces a six-hour minimum interval
and is preserved by ordinary operations. Gateway schedules idle heartbeats and
Hermes follows its suggested delay. See the
[heartbeat rules](probabilistic-light-client.md#permissionless-hoststate-heartbeats).

### Client Root Updates

Covered by `contract.host.update_client.valid`,
`contract.host.update_client.invalid_wrong_root`, and
`contract.host.update_client.invalid_wrong_redeemer`.

The UpdateClient properties construct a HostState UTxO plus a client UTxO,
commit the old client state into the old HostState root, and require the
validator to accept only the transition whose new root exactly applies the
client-state update. The mutations check these invariants:

- A client datum change must be reflected in the new HostState root.
- An arbitrary or stale HostState root cannot authorize an updated client UTxO.
- Client updates must use the `UpdateClient` HostState redeemer branch.

### Connection Root Updates

Covered by `contract.host.update_connection.valid` and
`contract.host.update_connection.invalid_uncommitted_connection_change`.

The UpdateConnection properties construct a HostState UTxO plus a connection
UTxO, commit the old connection end into the old HostState root, and require the
validator to accept only the transition whose new root commits the updated
connection end. The mutation checks these invariants:

- A connection datum change must be reflected in the new HostState root.
- The HostState root cannot stay unchanged while a connection UTxO changes.

### Channel Root Updates

Covered by `contract.host.update_channel.valid`,
`contract.host.update_channel.invalid_packet_field_change`, and
`contract.host.update_channel.invalid_receive_height_mutation`.

The UpdateChannel properties construct a HostState UTxO plus a channel UTxO and
require the channel-end update branch to commit only the channel end. The
mutation changes packet/sequence fields under the UpdateChannel redeemer and
must be rejected, checking these invariants:

- Channel-end changes must be reflected in the new HostState root.
- Packet commitments, receipts, acknowledgements, sequence fields, and packet
  history proof-height bounds cannot be changed through the channel-end-only
  branch.

### Packet Root Updates

Covered by `contract.host.handle_packet.valid_send`,
`contract.host.handle_packet.valid_recv`,
`contract.host.handle_packet.valid_ack`,
`contract.host.handle_packet.valid_timeout`,
`contract.host.handle_packet.invalid_channel_only_change`,
`contract.host.handle_packet.invalid_recv_channel_mutation`,
`contract.host.handle_packet.invalid_commitment_capacity`,
`contract.host.handle_packet.invalid_history_capacity`,
`contract.host.handle_packet.invalid_ack_capacity`, and
`contract.host.handle_packet.invalid_wrong_packet_key`.

These channel-datum HandlePacket properties construct HostState plus channel
UTxO transitions for packet commitment insertion, packet receipt insertion and
packet commitment deletion. These represent send, receive, acknowledge and timeout root effects.
The mutations check these invariants:

- Packet effects must use the packet-root HostState branch.
- Send-like packet commitment insertion must update the committed packet key.
- Recv-like receipt insertion must update the committed receipt key.
- Packet-root insertion cannot grow a channel past the ledger-safe bound of 64
  combined commitment, receipt, and acknowledgement entries.
- Ack/timeout-like commitment deletion must update the committed packet key.
- A channel-only change cannot be smuggled through the packet branch.
- A receive cannot combine otherwise valid receipt and acknowledgement root
  updates with a counterparty or connection rebind.
- A packet update committed under the wrong packet key is rejected.

## Trace Registry Append

Historical scenario suffixes:

- `contract.trace.append.valid`
- `contract.trace.append.invalid_missing_voucher_mint`
- `contract.trace.append.invalid_wrong_bucket`
- `contract.trace.append.invalid_duplicate_active_hash`
- `contract.trace.append.invalid_duplicate_archived_hash`
- `contract.trace.append.invalid_inactive_shard`

### Valid Append Transition

Covered by `contract.trace.append.valid`.

The append property constructs a valid active-shard append transaction and
requires the shard-side validator to accept it. The valid transition must
satisfy these invariants:

- The spent shard is the active shard named by the registry directory bucket.
- The shard bucket index matches the voucher hash bucket.
- The updated shard contains exactly the previous entries plus the newly
  inserted trace entry.
- The inserted trace entry uses the expected `voucher_hash` and `full_denom`.
- The transaction includes the registry directory as a reference input.
- The transaction mints the matching CIP-67 user voucher asset under the
  production voucher policy.

### Append Voucher Mint Coupling

Covered by `contract.trace.append.invalid_missing_voucher_mint`.

The mutation replaces the expected voucher mint with an unrelated voucher asset.
The append must be rejected, checking these invariants:

- A trace append must be coupled to the voucher mint for the same voucher hash.
- A registry write cannot be authorized by an arbitrary voucher-policy mint.

### Bucket Correctness

Covered by `contract.trace.append.invalid_wrong_bucket`.

The mutation spends and updates a shard whose bucket does not match the voucher
hash bucket. The append must be rejected, checking these invariants:

- A trace entry may only be inserted into the bucket derived from its voucher
  hash.
- A valid voucher mint cannot authorize insertion into the wrong shard bucket.

### Active-Shard Duplicate Detection

Covered by `contract.trace.append.invalid_duplicate_active_hash`.

The mutation starts from an active shard that already contains the inserted
voucher hash. The append must be rejected, checking these invariants:

- The active shard cannot contain duplicate voucher hashes.
- Re-appending an already registered trace is rejected.

### Archived-Shard Duplicate Detection

Covered by `contract.trace.append.invalid_duplicate_archived_hash`.

The mutation provides an archived shard reference containing the inserted
voucher hash. The append must be rejected, checking these invariants:

- A voucher hash cannot be reinserted if it already exists in an archived shard.
- Duplicate detection covers historical shards listed by the directory, not only
  the active shard.

### Active Shard Authority

Covered by `contract.trace.append.invalid_inactive_shard`.

The mutation spends an archived shard while the directory names a different
active shard. The append must be rejected, checking these invariants:

- Only the currently active shard for a bucket may be appended.
- Archived shards cannot be mutated through the append path.

### Bounded Registry Capacity

Covered by
`trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit`,
`trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_near_byte_limit`,
`trace_registry_capacity.test.trace_registry_capacity_accepts_exact_entry_and_denom_limits`,
`trace_registry_capacity.test.trace_registry_capacity_rejects_oversized_denom_and_shard`,
and
`trace_registry_capacity.test.trace_registry_capacity_rejects_ninth_archive_and_ninth_hop`.

These boundary fixtures check these invariants:

- A full denom is at most 256 UTF-8 bytes and contains at most eight trace hops.
- A shard contains at most 32 entries and its encoded datum is at most 3,072
  bytes.
- A bucket lists at most eight archived shards, while the directory contains at
  most 16 unique bucket indices and at most 6,144 encoded bytes.
- A first-seen append remains within execution budget while checking all eight
  maximally populated archived shards.
- The ninth archive is rejected as new-denomination admission exhaustion; it is
  not a condition required by existing voucher mapping proofs.

## Trace Registry Rollover

Historical scenario suffixes:

- `contract.trace.rollover.valid`
- `contract.trace.rollover.invalid_non_target_bucket_changed`
- `contract.trace.rollover.invalid_old_shard_not_preserved`
- `contract.trace.rollover.invalid_new_shard_not_exact_entry`
- `contract.trace.rollover.invalid_missing_voucher_mint`
- `model.trace.append_rollover_lookup`

### Valid Rollover Transition

Covered by `contract.trace.rollover.valid`.

The rollover property constructs a near-production rollover transaction and
requires both the shard-side and directory-side validators to accept it. The
valid transition must satisfy these invariants:

- Exactly one target directory bucket moves from the previous active shard to a
  new active shard.
- The previous active shard is archived under the target bucket.
- The previous active shard output is preserved byte-for-byte as the archived
  shard output.
- The new active shard is fresh and contains exactly the newly inserted trace
  entry.
- The inserted trace entry uses the expected `voucher_hash` and `full_denom`.
- The transaction mints the new active shard NFT.
- The transaction includes the matching voucher mint that authorizes the trace
  registry write.
- The previous active shard is itself within capacity, and appending the new
  entry would cross either its count or encoded-byte limit.
- The directory-side `AdvanceDirectory` redeemer and shard-side
  `RolloverInsertTrace` redeemer agree on bucket, voucher hash, full denom, old
  active shard, and new active shard.

### Directory Bucket Isolation

Covered by `contract.trace.rollover.invalid_non_target_bucket_changed`.

The mutation changes only an unrelated non-target bucket. The rollover must be
rejected, checking these invariants:

- Rollover may modify only the target bucket.
- Non-target buckets must remain byte-for-byte unchanged.
- A valid target bucket transition cannot hide unrelated directory drift.

### Archived Shard Preservation

Covered by `contract.trace.rollover.invalid_old_shard_not_preserved`.

The mutation changes the archived copy of the previous active shard. The
rollover must be rejected, checking these invariants:

- The archived shard must preserve the previous active shard contents exactly.
- Existing trace entries cannot be dropped, replaced, or rewritten during
  rollover.
- Rollover cannot use archiving as a path to mutate historical trace data.

### New Active Shard Freshness

Covered by `contract.trace.rollover.invalid_new_shard_not_exact_entry`.

The mutation adds an extra old entry to the new active shard. The rollover must
be rejected, checking these invariants:

- The new active shard must contain exactly the newly inserted trace entry.
- The new active shard cannot inherit old shard entries.
- Rollover cannot duplicate or carry forward unrelated registry entries into
  the fresh shard.

### Rollover Voucher Mint Coupling

Covered by `contract.trace.rollover.invalid_missing_voucher_mint`.

The mutation removes the matching voucher mint while leaving the new shard NFT
mint. The rollover must be rejected, checking these invariants:

- A rollover registry write must be coupled to a matching voucher mint.
- Minting only the new active shard NFT is not sufficient authorization.
- The trace registry cannot be written arbitrarily without the corresponding
  voucher asset flow.

`trace_registry_rollover.test.trace_registry_rollover_insert_rejects_before_shard_capacity`
also checks that callers cannot force early rollovers to create cheap empty
archives.

### Append Rollover Lookup Model

Covered by `model.trace.append_rollover_lookup`.

The model property starts one entry below the shard count limit, appends an
existing trace entry to reach that limit, rolls the bucket to a new active shard
containing a newly inserted trace entry, and then performs lookup-style
assertions across the active and archived shard sets. It also runs the
shard-side and directory-side rollover validators for the rollover step. It
checks these invariants:

- A trace entry appended before rollover remains discoverable after the old
  active shard becomes archived.
- The trace entry inserted during rollover is discoverable in the new active
  shard.
- The modeled directory after rollover matches the validator-accepted updated
  directory.
- Rollover preserves historical lookup reachability instead of replacing the
  old active shard with only the new entry.

## Shutdown And Compatible Redeployment

Shutdown is covered by `lib/ibc/utils/shutdown.test.ak`,
`validators/host_state_stt.test.ak` and the compiled tests in
`cardano/offchain/src/shutdown.fuzz.test.ts` and `shutdown-drain.test.ts`.
The checks include:

- Entering shutdown requires the deployment authority and a finite upper
  validity bound. The grace period is at least 24 hours from that bound.
  New objects are blocked while permitted existing-state updates can drain
  outstanding work.
- Reclamation burns the exact state identity, preserves unrelated assets and
  returns the required reserves to the authorized recipient. One refund cannot
  pay for two reclaimed objects or fund transaction fees from their reserves.
- Outstanding vouchers and registered transfer shards retain their return
  dependencies. Finalization cannot discard a live transfer root.

Compatible redeployment is a separate protocol. The generated and fixed Aiken
checks in `validators/migration_adversarial.test.ak` and
`validators/migration_packet_model.test.ak` are complemented by compiled
`cardano/offchain/src/migration.test.ts` and `migration-accounting.test.ts`:

- Governance authorizes the exact successor implementation and addresses after
  the configured delay. Executors cannot substitute their own contracts.
- Each bounded move preserves authenticated identity, datum, reference script,
  non-ADA assets and reserves. Fees and additional deposits come from the
  executor. Pending claims cannot disappear or settle twice.
- Activation requires all object counters and the committed escrow inventory
  to be complete. Existing routes, voucher identities and backing survive.
  Ordinary traffic pauses during handover and cannot bypass the migration gate.
- A separate emergency quorum can tighten restrictions. Permission restoration
  requires delayed governance. Shutdown or retirement cannot bypass migration
  accounting.

The operator/cache regressions and independent guard controls are also required
by the migration CI jobs. See [compatible redeployment](state-preserving-redeployment.md)
for retained native runs and the remaining deployment qualifications. This is
different from replacing a channel connection or recovering a Cosmos client.

## Commitment And Wire Compatibility

The public interface is specified in [the commitment codec](cardano-commitment-codec.md).
`scripts/ci/check-aiken-wire-schema.mjs` protects HostState, Tendermint client and
consensus states, connection ends, channels, packet-lane datums, channel upgrades
and error receipts, including their referenced types. Its negative controls in
`check-aiken-wire-schema.test.mjs` reject consumed constructor, field order,
field type and field-count changes.

Regenerating the lock with a higher schema version cannot approve a changed
destination layout. A separate reviewed fingerprint remains pinned. Existing
hosts need compatible decoders or an explicitly coordinated transition.

Cross-language vectors already exist in
`cosmos/cardano-probabilistic-light-client-core/commitmentcodec/codec_test.go`,
`packet_lanes_test.go` and the observation transport tests. They check exact
encodings and malformed-record rejection. Commitment proofs authenticate the
original bytes. Decoded semantic equivalence cannot authorize a different root.
The schema lock, commitment codecs, snapshot storage marker and verification
generation are separate compatibility boundaries.

## Probabilistic Cardano Client

These are Go state-machine and adapter checks, not Aiken property labels. Shared
verification lives in `cosmos/cardano-probabilistic-light-client-core/state`.
Test filenames below are relative to that directory unless an adapter is named.
The supported format is snapshot storage version `2`. Inline version `0` and
other markers are rejected. See [bounded verification](probabilistic-bounded-verification.md)
for the work calculation and [the client design](probabilistic-light-client.md)
for the verification rules.

Native block evidence does not independently authenticate stake amounts in an
uncertified allocation. The stake-omission fixtures and bounded-verification
document describe cases where restoring availability requires authorized
recovery rather than an automatically constructible challenge.

- `verification_state_test.go` and `snapshot_map_test.go` check bounded public
  records, shared immutable pages and selective updates. Snapshot objects and
  host observation-clock state belong to the application's authenticated store
  and export/import state, not an external service.
- `mithril_bootstrap_test.go` checks that bounded initialization finishes with
  certification of the exact bootstrap stake table. The initial checkpoint
  trusts the operator's configured Cardano context. Bootstrap certification
  starts no uncertified-allocation response window.
- `native_settlement_test.go`, `cross_epoch_settlement_test.go` and
  `observation_zero_stake_test.go` distinguish native eligibility in the block's
  epoch from qualification against the anchor table. An absent anchor stake row
  contributes zero. A malformed stored row remains an error. Registration age,
  recent production and capped settlement credit remain independently checked.
- `observation_capacity_test.go` and the v8 adapter's
  `staged_session_safety_test.go` check the maximum supported workload and
  interference by another submitter. Authentic uploads must respect the
  protocol's segment sizes. Retries and repeated completion cannot consume
  another submitter's remaining activation budget.
- `observation_native_test.go`, `observation_expiry_test.go` and the v8 adapter's
  `staged_session_expiry_test.go` check public sessions with no signer owner.
  Permissionless discard and cleanup preserve unexpired sessions in the active
  verification generation. New sessions expire after 24 hours of the shared
  host observation clock, which excludes interrupted intervals.
  Cleanup uses the same expiry predicate. Neither saved progress nor arbitrary
  new sessions extend the client's trust lifetime or an allocation's deadline.
- `epoch_usability_test.go`, `mithril_stake_test.go` and
  `host_continuity_test.go` check the six-hour response window for uncertified
  allocations. Interrupted host intervals pause unfinished windows. Certified
  and already usable allocations remain usable. Matching certification ends
  the remaining stake wait, while a contradicting certificate freezes the
  client. Activation and proofs require a completed host block after their
  applicable cutoff.
- `checkpoint_expiry_snapshot_test.go` checks expiry against the latest
  committed checkpoint's authenticated Cardano time. Rootless checkpoints can
  renew the client without publishing a new IBC proof root. Uploads and table
  proposals alone cannot renew it or reserve activation after expiry.
- `observation_native_test.go`, `retained_evidence_test.go` and
  `recovery_retry_test.go` check receipt-backed historical challenges and
  authorized recovery. Recovery pins a compatible active substitute and
  advances the verification generation. Discarded-generation proofs and
  sessions cannot become valid again through cleanup or retry.

The v8 adapter's `admission_challenge_test.go` checks a receipt-backed challenge
through `MsgUpdateClient`, CheckTx, ReCheckTx and committed execution. Admission
leaves state unchanged. Committed verified misbehaviour freezes the client.
The adapter keeper fixtures and Hermes operation-event tests additionally check
event collection for the supported update types.

The [native Injective readiness run](../tests/injective-probabilistic-lifecycle/READINESS.md)
uses Hermes and CometBFT with synthetic source history. It does not establish
the full production Cardano-to-Injective lifecycle.

## Follow-Up Tasks

- Add execution-coverage feedback and a retained corpus of cases that reach new
  behavior. The scheduled campaign currently samples fresh random histories.
- Extend randomized compiled funds histories to ordered and multiple channels
  and first-seen voucher registration with trace-registry rollover. Existing
  fixed packet-lane tests already exercise first-seen registration and returns.
- Exercise client creation, updates and misbehaviour together with packet
  histories rather than supplying an authenticated counterparty reference state.
- Extend the targeted guard mutants in `scripts/ci/check-aiken-mutations.mjs`.
  Current controls cover registered-client identity and proof policy, receive
  replay, send/refund amounts and send-commitment binding. They are a detection
  baseline, not a mutation score for the protocol.
- Add `assert_rejected_by` helpers to the Aiken fixture DSL to identify the
  intended rejecting predicate in composed handler tests.
- Extend the existing cross-language fixtures when public encodings change and
  demonstrate the decoder/deployment transition before using changed bytes.

## Current Coverage Boundary

Coverage must be read at the layer that actually executes the check:

- Aiken helper and `ProtocolTxFixture` tests execute explicitly selected
  predicates or handlers. Fixed packet sequences and staged-client freezing
  fixtures are regressions, not generated whole-protocol histories.
- Deno channel-action fuzzing and compiled funds histories execute the selected
  transaction scripts. The stateful funds campaign uses one unordered channel
  and registered voucher metadata with harness-supplied counterparty consensus
  references. It does not advance a real counterparty client for every step.
- Fixed packet-lane transactions add first-seen voucher registration, native
  returns, batching, rollback reload and multi-asset accounting. They do not
  turn those cases into randomized multi-channel or ordered funds histories.
- Compiled migration, shutdown and independent packet-model checks cover their
  own transitions. They do not establish every combination with live client,
  connection, channel-upgrade and packet lifecycles.
- Go unit/keeper fixtures and retained native application runs cover the
  destination client separately. A synthetic source history is not a complete
  live Cardano-to-Injective deployment rehearsal.

The exact intended Injective application, approved chain parameters and complete
production-component lifecycle still need retained deployment evidence. See the
remaining gates in the [readiness report](../tests/injective-probabilistic-lifecycle/READINESS.md),
[channel upgrades](channel-upgrades.md) and
[compatible redeployment](state-preserving-redeployment.md).
Passing iterations, labels, size measurements or targeted mutants alone do not
establish sufficient assurance for production custody.
