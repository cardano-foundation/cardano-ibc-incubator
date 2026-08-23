# Persistent IBC State Reclamation Lifecycle

This document describes the reclamation rules used by fresh deployments. The
change updates validator hashes and the wire format, so it cannot make objects
from an older deployment burnable after the fact.

## Why reclamation needs protocol rules

Clients, connections, channels, and transfer escrow shards are authenticated by
NFTs and represented by UTxOs. Before this lifecycle was added, their validators
always required a successor output. Closing a channel therefore stopped new
packets but did not release its UTxO, authentication token, minimum ADA, or
Gateway indexing cost.

Deleting an output is only safe after the protocol can prove that nothing still
depends on it. The proof is part of the same transaction that updates HostState
and burns the object's NFT; a Gateway database scan is never used as an on-chain
absence check.

## Rules shared by every object

- Creation sequence numbers only increase, so an identifier is never reused.
- Reclamation burns exactly one object NFT and no other asset under that policy.
- No output may retain the burned NFT.
- The HostState commitment update and every dependency-count change happen in
  the same transaction as the burn.
- A parent cannot be reclaimed while its authenticated child count is nonzero.
- Protocol value must be settled before cleanup. The remaining minimum ADA in a
  core object is paid in full to the cleanup submitter; transaction fees come
  from ordinary wallet inputs.
- Reclamation is final. There is no transition from reclaimed back to live.

Fresh deployments authenticate the bounded counts in these places:

- `HostState.live_client_count`
- `HostState.live_connection_count`
- `HostState.live_channel_count`
- `ConnectionDatum.live_channel_count`
- `cardano/dependencies/v1/clients/{clientId}/liveConnections` in the HostState
  sparse tree

The global counts fit in the small HostState datum, and the channel count fits
in its small parent connection datum. Keeping only the per-client connection
count in the sparse tree avoids adding several 64-level Merkle witnesses to the
already large channel-creation transaction.

Client creation initializes its connection count to zero and increments the
global client count. Connection creation increments the client's count and the
global connection count. Channel creation spends and recreates its parent
connection with its channel count increased and increments the global channel
count. Reclamation performs the exact inverse and rejects missing, stale,
negative, or mismatched counts.

Cardano limits the size of a script stored in a reference output. The HostState
validator therefore delegates the detailed transition check to one of four
small minting policies: creation, ordinary client/connection/channel updates,
packet handling, or cleanup. The selected policy mints one `ibc_lifecycle`
receipt into the continuing HostState output, while every other HostState
transaction must preserve the receipts already there. This lets the HostState
validator require proof that the matching detailed check ran in the same
transaction without making the HostState script too large to deploy.

## Packet cleanup after close

Closing a channel blocks `SendPacket` and `RecvPacket`, but existing work can
still drain. Acknowledgements and timeouts may delete outbound commitments on a
Closed channel, and packet-history pruning may remove finalized inbound history.

Unordered pruning deletes the receipt and acknowledgement together. Ordered
channels have no receipt, so pruning deletes only the acknowledgement. Both
cases still require an authenticated proof that the source commitment is absent
at a height at or above the channel's receive high-water mark and replay floor.
An unordered timeout on an already Closed channel preserves Closed instead of
accidentally reopening it.

## Channel lifecycle

A normal channel is reclaimable when it is Closed and all three packet maps are
empty. A channel stuck in `Init` or `TryOpen` can instead enter
`Abandoning { not_before }` with the deployment authority's signature. Its
seven-day delay is fixed by the validator, and ordinary channel operations stop
as soon as abandonment begins. The delay starts at the transaction's upper
validity bound, and the validator accepts only a finite, ordered validity range
of at most 601 seconds, so an old lower bound cannot backdate the deadline.

Channel reclamation also spends and recreates its parent connection with one
fewer live channel. The registered application must approve the same channel ID
through `OnChanReclaim` and prove that its application-owned children are gone.

A reclaimed Closed channel keeps two immutable commitment leaves:

- its standard Closed channel end, used by a later `ChannelCloseConfirm`; and
- `nextSequenceRecv`, used by ordered timeout proofs on the counterparty.

`nextSequenceSend` and `nextSequenceAck` are deleted. An abandoned pre-open
channel deletes its channel end and all three sequence leaves. No extra local
channel tombstone is needed: the allocation sequence cannot move backwards and
the channel NFT has been burned under a policy that can never mint that
identifier again.

## Connection lifecycle

IBC connections do not have a standard close state. The deployment authority
therefore starts `Retiring { not_before }`, with a validator-fixed seven-day
delay. Retirement immediately blocks handshake advancement and new channels,
while existing channels may still close, drain, and be reclaimed. As with
channel abandonment, the deadline is anchored to the bounded transaction upper
validity bound rather than a caller-selected lower bound.

After the deadline, a connection is reclaimable only when
`live_channel_count == 0`. The transaction deletes its standard connection
leaf, decrements its client's authenticated connection count and the global
connection count, and burns the connection NFT. The monotonic sequence and burn
make a separate local tombstone unnecessary.

## Client lifecycle

A Tendermint client is terminal only when it is Frozen or Expired at the
transaction's lower validity bound. An active or merely idle client cannot be
reclaimed.

During `ShuttingDown`, client updates remain available only when the complete
transaction validity interval ends strictly before `grace_period_end`. No
update can land at or after that cutoff, so every unfrozen client must
eventually expire and become reclaimable once its trusting period elapses.

Consensus history can be large, so a terminal client removes at most two
non-latest consensus states per pruning transaction. Each removed state has its
own HostState commitment witness, and the matching processed-time and
processed-height entries are removed with it. The latest consensus state stays
until the final transaction.

Final client reclamation requires a zero live-connection count and exactly the
latest consensus state with its matching metadata. It deletes the client state,
latest consensus state, and count leaf, decrements the global client count, and
burns the client NFT.

## Transfer escrow and voucher accounting

Transfer escrow shards now record `escrowed_amount` separately from their
physical value. This distinction matters for lovelace because a zero ADA
principal shard still needs minimum ADA while it exists. Non-ADA shards require
the physical asset quantity to equal the recorded principal; an ADA shard may
hold additional lovelace only for its UTxO reserve.

The transfer module records:

- a global live escrow-shard count;
- global logical voucher supply;
- the voucher supply attributable to each channel in that channel's datum;
- a per-channel live-shard count in its registry tree; and
- a live or retired marker for every deterministic shard identity.

Fresh deployments accept only the V2 shard-creation redeemer. Creation changes
the marker from absent to live and increments both shard counts. A zero-principal
shard on a terminal channel can be reclaimed by changing the marker from live
to retired, decrementing the counts, burning exactly one shard NFT, and omitting
a shard successor. When the last shard leaves a channel, its count leaf returns
to absent; `OnChanReclaim` proves that absence with a bounded Merkle witness.

Voucher mint, burn, and refund paths update both authenticated totals by the
exact policy amount. Receiving a voucher increments the destination channel's
amount, returning a voucher through its source channel decrements that channel's
amount, and a failed return restores the source channel's amount. Native-token
packet paths preserve the amount. The voucher policy derives the channel token
from the packet itself, binds it to the transfer port, and requires exactly one
matching channel input and successor, so a transaction cannot charge the change
to another channel. The packet authorization policy prevents callbacks from
changing a channel's amount when the configured voucher policy did not run.

An individual channel can be reclaimed only when its own voucher amount and its
own live escrow-shard count are both zero. Voucher supply attributed to another
channel does not block that cleanup. The global voucher supply must still reach
zero before the transfer module itself can be reclaimed during final shutdown.
This preserves a consensus-enforced liability for every wallet-held voucher
instead of relying on a Gateway scan or treating unrelated supply as settled.

The shard's remaining minimum ADA is absorbed into the transfer module output,
not paid as a cleanup reward. Voucher mint and burn paths adjust the module's
logical voucher supply by the exact policy delta. Channel close callbacks do not
require zero balances, because refunds and timeouts must continue after close.

Standalone application cleanup uses the root-neutral `UpdateModuleState`
HostState operation. It is allowed while Active or ShuttingDown, preserves the
IBC root and all core counts, and requires the registered module root to be
spent with an application `Operator` action. This lets a zero-balance escrow
shard retire after shutdown has begun without weakening the ordinary HostState
heartbeat rules.

Trace-registry mappings remain permanent for the deployment. Wallet-held
vouchers may still need those mappings after the channel that introduced a
trace has closed.

## Ordered shutdown

Shutdown is `Active -> ShuttingDown -> Sealed -> burned`.

`ShuttingDown` rejects new clients, connections, channels, source deposits, and
generic application sends. Transfer sends that burn existing vouchers remain
available so users can return them, while acknowledgements, timeouts, refunds,
pruning, and reclamation continue. After the configured shutdown grace period
has ended and all three core live counts reach zero, each bound module is
reclaimed in its own transaction. HostState authenticates the module root and its
`OnHostStateSeal` callback, then replaces the live port key with a key prefixed
by a reserved zero byte. Normal module lookup no longer recognizes that key,
while removing the prefix recovers the original registration for commitment
tree reconstruction. The transfer module accepts the callback only when its
live shard count and voucher supply are both zero. Its exact ADA and capability
tokens are paid to the deployment authority; the tokens are deliberately
preserved but no longer have protocol authority.

One module is handled per transaction so shutdown remains within Cardano's
execution limits regardless of how many applications are registered. Once
every registration has the retired prefix, HostState can become Sealed without
co-spending any module root.

Sealing preserves the final proof root and starts a fixed seven-day proof
window. No ordinary HostState transition is allowed from Sealed. Reference
scripts remain locked until the window ends, after which the shutdown tool
reclaims them in bounded batches. Once every reference script is gone, the final
transaction requires the deployment signature, burns exactly one HostState NFT,
leaves no NFT-bearing output, and returns the HostState ADA. The old
`FinalizeShutdown` constructor remains decodable for compatibility but always
rejects; a timer alone is not a drain proof.

Shutdown entry and sealing record the transaction's upper validity bound as
their authenticated timestamp, using the same finite 601-second interval cap.
Sealing also requires the lower validity bound to be at or after the grace
deadline. The seven-day final-proof window therefore cannot be shortened by
submitting a transaction with a stale lower bound.

The operator sequence is `enter`, drain and reclaim live objects, `seal`,
`reclaim-reference-scripts`, then `finalize`, using
`cardano/offchain/scripts/shutdown-deployment.ts`. The `seal` command first
submits one transaction for each remaining application root and then submits
the HostState sealing transaction. The `status` command reports the current
phase and deadlines without changing chain state.

A schema-v6 deployment commits to its complete reference-script inventory before
registration starts. The HostState reference is first, and every other entry is
ordered canonically by transaction hash and output index. Each bounded
registration batch names its exact output references and advances an
authenticated count and hash-chain root; normal HostState transitions remain
blocked until the committed target is reached. A crash-safe deployment journal
stores the full plan and resumes only when the wallet, chain cursor, count, and
root still agree.

The published handler records the same ordered `referenceOutRefs` inventory and
the persisted reference-validator script, hash, and address. The shutdown tool
requires all runtime validators, all channel helper validators, and an exact
match between those entries and the inventory. It reclaims only an authenticated
suffix in each batch and deliberately leaves the HostState reference until the
end. Before reclaiming or finalizing, it compares Kupo's detailed output data
with an exact `queryLedgerState/utxo` lookup from Ogmios. A missing Kupo result is
therefore never treated as proof that an output was spent, including when Kupo
began indexing after deployment. The final transaction consumes both HostState
and its reference-script output as ordinary inputs, burns the HostState NFT, and
permits neither a HostState nor reference-validator successor.

## Gateway recovery and deployment compatibility

Live list queries discover current objects from indexed UTxOs rather than
probing every historical sequence number. A cold rebuild reconstructs client
connection counts by grouping live connections under live clients. During
shutdown it also strips the reserved prefix from retired module registrations,
so those registrations continue to produce the same committed port leaves.

Current UTxOs are not enough after channel reclamation because a Closed channel
end and `nextSequenceRecv` intentionally survive without an object UTxO. The
Gateway therefore replays canonical Kupo history for the channel policy and
restores the latest burned Closed channel outputs. Kupo must retain spent output
history and must not run with UTxO pruning enabled. Provider gaps, ambiguous NFT
history, or a rebuilt root mismatch fail closed.

The transfer registry follows the same rule. A cold rebuild combines live
escrow shards with spent history so retired markers and per-channel live counts
are restored before the rebuilt registry root is compared with the module
datum.

The bridge manifest schema is version 6. Datum fields and redeemer constructors
are appended to preserve the indices of older constructors, but all affected
validator hashes change. An older deployment has no authorized burn branch for
its existing NFTs, so it must be drained conservatively or handled by a separate
migration; it must not be reported as reclaimable under these rules.
