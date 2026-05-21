# Aiken Fuzzing Invariants

This document records the protocol invariants currently exercised by the
Aiken property-based fuzzing suite. It is intentionally limited to invariants
that are covered by existing fuzz/property tests and their CI-enforced labels.

## Label Depths

CI-enforced labels use an explicit depth prefix:

- `unit.*` labels cover pure module logic and small isolated helpers.
- `contract.*` labels cover validator-facing or near-valid transition fixtures.
- `tx.*` is reserved for full transaction fixture coverage.
- `model.*` is reserved for model/state-machine sequence coverage.

The current suite uses `unit.*` and `contract.*` labels. The coverage checker
rejects labels that do not start with one of these depth categories, so future
fuzzing work can require `tx.*` or `model.*` coverage independently from lower
level checks.

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

All Boolean-returning fuzz properties now use this DSL assertion shape. Valid
fixtures flow through `valid_check(...).assert_valid`, and near-valid mutations
flow through `mutated_check(...).assert_rejected`. The packet SendPacket
properties use the fuller composable fixture pattern:

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

Some validator properties intentionally remain as Aiken `test ... fail` cases.
Those validators abort through hard `expect` failures rather than returning a
Boolean rejection result, and Aiken does not provide a local catch mechanism for
turning that abort into a `TxFixture` check. Those tests still carry
CI-enforced labels, while the DSL covers the properties where the validator or
model check returns an inspectable accept/reject Boolean.

The fuzz suite currently covers:

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

## Client Update And Misbehaviour

Required CI labels:

- `unit.client.update.valid_adjacent`
- `unit.client.update.valid_non_adjacent`
- `contract.client.update.invalid_wrong_host_redeemer`
- `unit.client.update.invalid_wrong_consensus_state`
- `contract.client.update.invalid_missing_host_state`
- `unit.client.misbehaviour.valid_same_height_conflict`
- `unit.client.misbehaviour.valid_time_violation`
- `unit.client.misbehaviour.invalid_monotonic_headers`
- `unit.client.misbehaviour.invalid_same_header`
- `unit.client.misbehaviour.invalid_wrong_client_id`
- `unit.client.frozen.rejects_update`

### Header Update Transitions

Covered by `unit.client.update.valid_adjacent`,
`unit.client.update.valid_non_adjacent`, and
`unit.client.update.invalid_wrong_consensus_state`.

The update properties construct client datum transitions around generated
heights and require `update_state` to accept both adjacent and non-adjacent
header updates. The mutation commits the wrong consensus state for the submitted
header and must be rejected, proving these invariants:

- A valid update can advance to the immediately next height.
- A valid update can advance to a non-adjacent higher height.
- The output consensus state must exactly match the submitted header.
- The client latest height must move to the submitted height when the submitted
  height is newer.

### HostState Coupling

Covered by `contract.client.update.invalid_wrong_host_redeemer` and
`contract.client.update.invalid_missing_host_state`.

The spending-client properties use minimal transactions that fail before
expensive Tendermint verification. They prove these invariants:

- A client update must be co-spent with HostState.
- The co-spent HostState must use the `UpdateClient` redeemer branch.
- A different HostState redeemer branch cannot authorize a client update.

### Misbehaviour Detection

Covered by `unit.client.misbehaviour.valid_same_height_conflict`,
`unit.client.misbehaviour.valid_time_violation`,
`unit.client.misbehaviour.invalid_monotonic_headers`,
`unit.client.misbehaviour.invalid_same_header`, and
`unit.client.misbehaviour.invalid_wrong_client_id`.

The misbehaviour properties exercise the detection logic for conflicting
headers and time-order violations. They prove these invariants:

- Same-height headers with different block hashes are detected as
  misbehaviour.
- A higher-height header whose timestamp does not increase is detected as
  misbehaviour.
- Monotonic headers are not falsely treated as misbehaviour.
- Re-submitting the same header is not falsely treated as misbehaviour.
- Explicit misbehaviour evidence with a malformed client identifier is
  rejected.

### Frozen Client Rejection

Covered by `unit.client.frozen.rejects_update`.

The frozen-client property constructs a non-zero frozen height and checks that
client status is `Frozen`. Since the spending client validator requires
`Active` status before accepting updates, this proves that a frozen client is
not updateable.

## Connection And Channel Handshakes

Required CI labels:

- `unit.conn.open_try.valid`
- `contract.conn.open_try.invalid_missing_client_proof`
- `contract.conn.open_try.invalid_wrong_counterparty_client_state`
- `contract.conn.open_try.invalid_wrong_host_redeemer`
- `unit.conn.open_ack.valid`
- `contract.conn.open_ack.invalid_wrong_proof_height`
- `contract.chan.open_ack.valid`
- `contract.chan.open_confirm.valid`
- `contract.chan.close_init.valid_or_rejected_by_app_policy`
- `contract.chan.close_confirm.valid`
- `contract.chan.closed.rejects_send`

### Connection Open Try

Covered by `unit.conn.open_try.valid`,
`contract.conn.open_try.invalid_missing_client_proof`,
`contract.conn.open_try.invalid_wrong_counterparty_client_state`, and
`contract.conn.open_try.invalid_wrong_host_redeemer`.

The valid unit property exercises the pure connection datum transition for a
TryOpen connection. The wrong-counterparty-client-state property now builds a
near-valid ConnOpenTry transaction and runs the connection minting validator,
HostState CreateConnection validator, and connection datum transition against
the same fixture before mutating only the counterparty client-state proof
value. The remaining proof-shape and HostState-redeemer properties are
smoke/regression checks for narrow redeemer gates. Together they prove these
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
`contract.conn.open_ack.invalid_wrong_proof_height`.

The valid property exercises the pure connection datum transition from Init to
Open with a concrete counterparty connection identifier. The proof-height
contract property checks that an OpenAck proof redeemer cannot silently use a
different proof height. These properties prove these invariants:

- ConnOpenAck must move a connection from `Init` to `Open`.
- ConnOpenAck must set the counterparty connection id while preserving the
  other committed connection fields.
- ConnOpenAck proof authorization is tied to the requested proof height.

### Channel Handshakes And Close

Covered by `contract.chan.open_ack.valid`, `contract.chan.open_confirm.valid`,
`contract.chan.close_init.valid_or_rejected_by_app_policy`,
`contract.chan.close_confirm.valid`, and `contract.chan.closed.rejects_send`.

The channel properties exercise the shared channel datum transition functions
for OpenAck, OpenConfirm, CloseInit, and CloseConfirm. The closed-channel
property covers the send-packet validator's open-channel gate. They prove these
invariants:

- ChanOpenAck must move a channel from `Init` to `Open` and commit the
  counterparty channel id.
- ChanOpenConfirm must move a channel from `TryOpen` to `Open`.
- ChanCloseInit must close an open channel at the core datum layer, while app
  policy may still reject the close path before this transition is accepted.
- ChanCloseConfirm must close an open channel.
- A closed channel does not satisfy the send-packet open-channel gate.

## Packet Lifecycle

Required CI labels:

- `contract.packet.send.valid`
- `contract.packet.send.invalid_wrong_sequence`
- `contract.packet.send.invalid_missing_commitment_root_update`
- `contract.packet.send.invalid_wrong_transfer_callback`
- `contract.packet.recv.valid_receipt`
- `contract.packet.recv.invalid_duplicate_receipt`
- `contract.packet.ack.valid_success`
- `contract.packet.ack.valid_error`
- `contract.packet.ack.invalid_wrong_ack_bytes`
- `contract.packet.timeout.valid_unordered`
- `contract.packet.timeout.valid_ordered`
- `contract.packet.timeout.invalid_before_timeout`

### SendPacket

Covered by `contract.packet.send.valid`, `contract.packet.send.invalid_wrong_sequence`,
`contract.packet.send.invalid_missing_commitment_root_update`, and
`contract.packet.send.invalid_wrong_transfer_callback`.

The SendPacket properties build a valid open-channel packet-send transition and
then mutate exactly one field per negative case. They prove these invariants:

- A valid send increments `next_sequence_send` and inserts the exact packet
  commitment under the packet sequence.
- The packet sequence must equal the channel datum's current
  `next_sequence_send`.
- The packet commitment/root effect cannot be omitted while the sequence is
  advanced.
- The transfer callback/channel redeemer must refer to the same packet bytes;
  a callback for a different transfer payload is rejected.

### RecvPacket

Covered by `contract.packet.recv.valid_receipt` and
`contract.packet.recv.invalid_duplicate_receipt`.

The RecvPacket properties construct an unordered receive transition that writes
the receipt and acknowledgement commitment, then mutate the input datum to
already contain the receipt. They prove these invariants:

- A valid unordered receive records a receipt for the packet sequence.
- A valid receive records the acknowledgement commitment for the packet
  sequence.
- A packet cannot be received again if its receipt already exists.
- A packet cannot be received again if its acknowledgement already exists.

### AcknowledgePacket

Covered by `contract.packet.ack.valid_success`, `contract.packet.ack.valid_error`, and
`contract.packet.ack.invalid_wrong_ack_bytes`.

The acknowledgement properties construct a near-valid source-side packet
commitment and apply success and error acknowledgement bytes. They prove these
invariants:

- A valid acknowledgement consumes the packet commitment.
- Success acknowledgement bytes must be the canonical marshalled acknowledgement
  payload.
- Error acknowledgement bytes must be the canonical marshalled acknowledgement
  payload.
- Mismatched acknowledgement bytes are rejected even when the channel datum
  transition is otherwise valid.

### TimeoutPacket

Covered by `contract.packet.timeout.valid_unordered`,
`contract.packet.timeout.valid_ordered`, and `contract.packet.timeout.invalid_before_timeout`.

The timeout properties construct committed packets and apply unordered and
ordered timeout transitions. They prove these invariants:

- A valid unordered timeout consumes the packet commitment and keeps the channel
  open.
- A valid ordered timeout consumes the packet commitment and closes the channel.
- A timeout cannot execute before the packet timeout timestamp has been reached.

## Transfer Module Accounting

Required CI labels:

- `contract.transfer.native_send.escrow_increases_exactly`
- `contract.transfer.native_timeout.refund_exactly`
- `contract.transfer.native_ack.no_refund`
- `contract.transfer.voucher_send.burns_exactly`
- `contract.transfer.voucher_error_ack.remints_exactly`
- `contract.transfer.recv_source.unescrows_exactly`
- `contract.transfer.recv_sink.mints_voucher_exactly`
- `contract.transfer.invalid_extra_voucher_mint_rejected`
- `contract.transfer.invalid_wrong_escrow_delta_rejected`
- `contract.transfer.invalid_wrong_native_refund_amount_rejected`
- `contract.transfer.invalid_wrong_voucher_burn_amount_rejected`
- `contract.transfer.invalid_wrong_escrow_shard_rejected`
- `contract.transfer.invalid_receiver_address_rejected`

### Native Token Escrow And Refunds

Covered by `contract.transfer.native_send.escrow_increases_exactly`,
`contract.transfer.native_timeout.refund_exactly`,
`contract.transfer.native_ack.no_refund`, and
`contract.transfer.recv_source.unescrows_exactly`.

The native-token accounting properties now have two layers. The helper-level
properties check exact value deltas for small focused accounting fixtures. The
validator-level properties build full `spending_transfer_module` transactions
with the channel redeemer, module callback or operator redeemer, HostState
co-spend, operation-specific voucher or escrow-shard redeemer, and escrow shard
inputs/outputs where the transition requires them. They prove these invariants:

- A native send must increase the matching escrow shard by exactly the transfer
  amount.
- A native timeout refund must reduce escrow by exactly the transfer amount and
  increase the original sender balance by exactly the transfer amount.
- A successful native acknowledgement must not change module value, refund the
  sender, or mint vouchers.
- Receiving a packet back on the source chain must unescrow exactly the packet
  amount to the Cardano receiver.

### Voucher Mint, Burn, And Refunds

Covered by `contract.transfer.voucher_send.burns_exactly`,
`contract.transfer.voucher_error_ack.remints_exactly`, and
`contract.transfer.recv_sink.mints_voucher_exactly`.

The voucher accounting properties also have two layers. The helper-level
properties check exact voucher-policy mint or burn values. The validator-level
properties build full `spending_transfer_module` transactions for voucher send,
sink-chain receive, and error acknowledgement refund paths, including the
channel packet redeemer, module redeemer, HostState co-spend, and voucher policy
redeemer expected by the module validator. They prove these invariants:

- Sending vouchers from a sink chain must burn exactly the packet amount.
- Error acknowledgements for sink-chain voucher sends must remint exactly the
  packet amount.
- Receiving a packet on the sink chain must mint exactly the packet amount of
  the canonical voucher asset.
- Voucher accounting cannot hide supply changes in the module state output.

### Accounting Mutations

Covered by `contract.transfer.invalid_extra_voucher_mint_rejected`,
`contract.transfer.invalid_wrong_escrow_delta_rejected`,
`contract.transfer.invalid_wrong_native_refund_amount_rejected`,
`contract.transfer.invalid_wrong_voucher_burn_amount_rejected`,
`contract.transfer.invalid_wrong_escrow_shard_rejected`, and
`contract.transfer.invalid_receiver_address_rejected`.

The mutation properties add one malicious difference to otherwise near-valid
accounting fixtures. The full validator-level mutations currently cover wrong
send escrow deltas and wrong native-token timeout refund amounts; the remaining
mutation labels are helper-level accounting checks. Together, they prove these
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

Required CI labels:

- `contract.voucher.first_mint.valid_metadata`
- `contract.voucher.first_mint.invalid_wrong_name`
- `contract.voucher.first_mint.invalid_wrong_ticker`
- `contract.voucher.first_mint.invalid_wrong_description`
- `contract.voucher.first_mint.invalid_wrong_full_denom`
- `contract.voucher.first_mint.invalid_wrong_policy`
- `contract.voucher.first_mint.invalid_wrong_reference_asset`
- `contract.voucher.existing_mint.rejects_reference_nft`

### First Mint Canonical Metadata

Covered by `contract.voucher.first_mint.valid_metadata`,
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
They prove these invariants:

- The display `name` must be derived from the base denomination.
- The display `ticker` must be derived from the base denomination.
- The display `description` must include the exact full denom trace.
- The non-display `fullDenom` field must match the trace-registry full denom.
- The embedded voucher policy id must match the voucher minting policy.
- The metadata output must carry the canonical CIP-67 reference NFT for the
  same denom hash.
- Human-readable metadata cannot claim a different denom, policy, or display
  identity than the voucher asset it describes.

### Existing Mapping Mint

Covered by `contract.voucher.existing_mint.rejects_reference_nft`.

The existing-mapping property constructs the mint value for an already-registered
voucher mapping and mutates it by adding a reference NFT. It proves this
invariant:

- Existing voucher mappings may mint only the user voucher asset; reference NFT
  creation is reserved for first-seen mappings.

## Verifying Proof

Required CI labels:

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
They prove these invariants:

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
and reject a vacuous empty batch. They prove these invariants:

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
key from the proof. They prove these invariants:

- A valid non-membership proof mints the proof marker for the absent key.
- A non-membership proof cannot be reused to prove absence of an existing key.

## HostState Root Transitions

Required CI labels:

- `contract.host.update_client.valid`
- `contract.host.update_client.invalid_wrong_root`
- `contract.host.update_client.invalid_wrong_redeemer`
- `contract.host.update_connection.valid`
- `contract.host.update_connection.invalid_uncommitted_connection_change`
- `contract.host.update_channel.valid`
- `contract.host.update_channel.invalid_packet_field_change`
- `contract.host.handle_packet.valid_send`
- `contract.host.handle_packet.valid_recv`
- `contract.host.handle_packet.valid_ack`
- `contract.host.handle_packet.valid_timeout`
- `contract.host.handle_packet.invalid_channel_only_change`
- `contract.host.handle_packet.invalid_wrong_packet_key`

### Client Root Updates

Covered by `contract.host.update_client.valid`,
`contract.host.update_client.invalid_wrong_root`, and
`contract.host.update_client.invalid_wrong_redeemer`.

The UpdateClient properties construct a HostState UTxO plus a client UTxO,
commit the old client state into the old HostState root, and require the
validator to accept only the transition whose new root exactly applies the
client-state update. The mutations prove these invariants:

- A client datum change must be reflected in the new HostState root.
- An arbitrary or stale HostState root cannot authorize an updated client UTxO.
- Client updates must use the `UpdateClient` HostState redeemer branch.

### Connection Root Updates

Covered by `contract.host.update_connection.valid` and
`contract.host.update_connection.invalid_uncommitted_connection_change`.

The UpdateConnection properties construct a HostState UTxO plus a connection
UTxO, commit the old connection end into the old HostState root, and require the
validator to accept only the transition whose new root commits the updated
connection end. The mutation proves these invariants:

- A connection datum change must be reflected in the new HostState root.
- The HostState root cannot stay unchanged while a connection UTxO changes.

### Channel Root Updates

Covered by `contract.host.update_channel.valid` and
`contract.host.update_channel.invalid_packet_field_change`.

The UpdateChannel properties construct a HostState UTxO plus a channel UTxO and
require the channel-end update branch to commit only the channel end. The
mutation changes packet/sequence fields under the UpdateChannel redeemer and
must be rejected, proving these invariants:

- Channel-end changes must be reflected in the new HostState root.
- Packet commitments, receipts, acknowledgements, and sequence fields cannot be
  changed through the channel-end-only branch.

### Packet Root Updates

Covered by `contract.host.handle_packet.valid_send`, `contract.host.handle_packet.valid_recv`,
`contract.host.handle_packet.valid_ack`, `contract.host.handle_packet.valid_timeout`,
`contract.host.handle_packet.invalid_channel_only_change`, and
`contract.host.handle_packet.invalid_wrong_packet_key`.

The HandlePacket properties construct HostState plus channel UTxO transitions
for packet commitment insertion, packet receipt insertion, and packet commitment
deletion. These represent send, receive, acknowledge, and timeout root effects.
The mutations prove these invariants:

- Packet effects must use the packet-root HostState branch.
- Send-like packet commitment insertion must update the committed packet key.
- Recv-like receipt insertion must update the committed receipt key.
- Ack/timeout-like commitment deletion must update the committed packet key.
- A channel-only change cannot be smuggled through the packet branch.
- A packet update committed under the wrong packet key is rejected.

## Trace Registry Append

Required CI labels:

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

### Voucher Mint Coupling

Covered by `contract.trace.append.invalid_missing_voucher_mint`.

The mutation replaces the expected voucher mint with an unrelated voucher asset.
The append must be rejected, proving these invariants:

- A trace append must be coupled to the voucher mint for the same voucher hash.
- A registry write cannot be authorized by an arbitrary voucher-policy mint.

### Bucket Correctness

Covered by `contract.trace.append.invalid_wrong_bucket`.

The mutation spends and updates a shard whose bucket does not match the voucher
hash bucket. The append must be rejected, proving these invariants:

- A trace entry may only be inserted into the bucket derived from its voucher
  hash.
- A valid voucher mint cannot authorize insertion into the wrong shard bucket.

### Active-Shard Duplicate Detection

Covered by `contract.trace.append.invalid_duplicate_active_hash`.

The mutation starts from an active shard that already contains the inserted
voucher hash. The append must be rejected, proving these invariants:

- The active shard cannot contain duplicate voucher hashes.
- Re-appending an already registered trace is rejected.

### Archived-Shard Duplicate Detection

Covered by `contract.trace.append.invalid_duplicate_archived_hash`.

The mutation provides an archived shard reference containing the inserted
voucher hash. The append must be rejected, proving these invariants:

- A voucher hash cannot be reinserted if it already exists in an archived shard.
- Duplicate detection covers historical shards listed by the directory, not only
  the active shard.

### Active Shard Authority

Covered by `contract.trace.append.invalid_inactive_shard`.

The mutation spends an archived shard while the directory names a different
active shard. The append must be rejected, proving these invariants:

- Only the currently active shard for a bucket may be appended.
- Archived shards cannot be mutated through the append path.

## Trace Registry Rollover

Required CI labels:

- `contract.trace.rollover.valid`
- `contract.trace.rollover.invalid_non_target_bucket_changed`
- `contract.trace.rollover.invalid_old_shard_not_preserved`
- `contract.trace.rollover.invalid_new_shard_not_exact_entry`
- `contract.trace.rollover.invalid_missing_voucher_mint`

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
- The directory-side `AdvanceDirectory` redeemer and shard-side
  `RolloverInsertTrace` redeemer agree on bucket, voucher hash, full denom, old
  active shard, and new active shard.

### Directory Bucket Isolation

Covered by `contract.trace.rollover.invalid_non_target_bucket_changed`.

The mutation changes only an unrelated non-target bucket. The rollover must be
rejected, proving these invariants:

- Rollover may modify only the target bucket.
- Non-target buckets must remain byte-for-byte unchanged.
- A valid target bucket transition cannot hide unrelated directory drift.

### Archived Shard Preservation

Covered by `contract.trace.rollover.invalid_old_shard_not_preserved`.

The mutation changes the archived copy of the previous active shard. The
rollover must be rejected, proving these invariants:

- The archived shard must preserve the previous active shard contents exactly.
- Existing trace entries cannot be dropped, replaced, or rewritten during
  rollover.
- Rollover cannot use archiving as a path to mutate historical trace data.

### New Active Shard Freshness

Covered by `contract.trace.rollover.invalid_new_shard_not_exact_entry`.

The mutation adds an extra old entry to the new active shard. The rollover must
be rejected, proving these invariants:

- The new active shard must contain exactly the newly inserted trace entry.
- The new active shard cannot inherit old shard entries.
- Rollover cannot duplicate or carry forward unrelated registry entries into
  the fresh shard.

### Voucher Mint Coupling

Covered by `contract.trace.rollover.invalid_missing_voucher_mint`.

The mutation removes the matching voucher mint while leaving the new shard NFT
mint. The rollover must be rejected, proving these invariants:

- A rollover registry write must be coupled to a matching voucher mint.
- Minting only the new active shard NFT is not sufficient authorization.
- The trace registry cannot be written arbitrarily without the corresponding
  voucher asset flow.

## Current Coverage Boundary

The current fuzzing suite does not yet provide property-level invariant
coverage for:

- client creation or update,
- full end-to-end connection handshake validator contexts,
- full end-to-end channel handshake validator contexts,
- full end-to-end packet lifecycle validator contexts,
- full end-to-end voucher metadata validator contexts,
- misbehaviour freezing.

Those areas may have unit or integration tests elsewhere, but they are not
currently represented in the CI-enforced Aiken fuzz label catalog.
