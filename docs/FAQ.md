# FAQ

## What happens if the Cardano contract deployer key is compromised?

The deployer key is an administrative trust boundary. A compromise can stop the
bridge permanently and can put user funds at risk. Here this means the payment
key whose hash is recorded in `HostStateDatum.deployer` for the current contracts.
The attacker can also spend any funds held directly by that wallet.

The attacker can enter irreversible shutdown. This immediately blocks new
clients, connections, channels, port registrations, and new source-chain escrow
deposits. Existing voucher returns and packet settlement or refunds remain
possible while the required state and scripts are available. The contracts
enforce a grace period of at least 24 hours from the shutdown transaction's
latest valid time. After that period, reference scripts can be reclaimed only
when no clients, connections, or channels remain live and the transfer root
has been drained. Final shutdown has the same live-state restrictions.

These checks do not settle packets or refund users by themselves. Shutdown
can still leave a route unusable until its remaining state is drained.
It does not give the deployer a direct withdrawal from transfer escrow.

The attacker can also authorize recovery of an expired or frozen Cardano-side
Tendermint client using an active substitute with matching parameters and a
newer height. This preserves the existing connections and channels but installs
the substitute's trusted consensus state. Those checks do not establish that
the chosen checkpoint represents the real counterparty chain. A malicious
substitute can therefore make forged packet proofs acceptable on the affected
route and enable unauthorized escrow releases or unbacked voucher minting.
Recovery cannot replace an active client. See
[Tendermint client recovery](tendermint-update-capacity.md#expired-or-frozen-client-recovery).

Other powers are registering previously unbound ports and submitting
`HostState` heartbeats. An attacker can occupy unused ports or exhaust the
bounded registry. Existing port registrations cannot be overwritten.
Heartbeats leave the IBC commitment root unchanged. The key does not provide
a general contract upgrade or arbitrary state-editing capability. A deployment
can name one backup operator before deployment. That key can claim the deployer
role at any time, so it must be trusted as an administrator. The backup cannot
be added or changed later. There is no shutdown-cancellation operation.

## What happens if the Cardano contract deployer key is lost?

Losing the key does not itself shut down the bridge or move, burn, or release
any vouchers or escrow. Ordinary client updates and packet operations do not
require the deployer signature. Existing routes can continue with other funded
signers and relayers while their clients remain usable. Any funds held directly
by the lost-key wallet become inaccessible.

Without a named backup, the deployment loses its administrative operations: binding new ports,
recovering expired or frozen Cardano-side Tendermint clients, submitting
heartbeats, and entering or finalizing shutdown. Deployment deposits that
require this authority to reclaim also become inaccessible. A deployment made
without a backup has no on-chain replacement-key procedure.

If the deployer named a backup before deployment, its holder can set
`DEPLOYER_SK` to that wallet's signing key and run
`shutdown-deployment.ts claim-backup`. This changes only the
recorded deployer and HostState version. The old key then loses its
administrative permissions. The chain cannot tell whether a key has been lost,
so the backup holder can claim at any time.

The main risk to existing funds is losing the ability to restore a stalled
route. If its Cardano-side client expires or freezes, normal proof-based
redemption and refunds may remain blocked without recovery. Escrow stays locked
and vouchers remain in wallets but continued possession does not guarantee
redemption. Creating a new deployment or client does not automatically migrate
existing channels, escrow, or vouchers. Losing heartbeat authority also removes
the dedicated way to advance `HostState` during quiet periods for counterparty
client updates. Valid ordinary activity can still advance it.

If the key is lost after shutdown has already begun, shutdown remains in effect.
The grace-period deadline does not automatically destroy `HostState`. Remaining
settlement paths can continue while the required state and scripts are available
but the lost key cannot cancel shutdown or complete the administrative cleanup.

## Why doesn't HostState use IAVL like Cosmos SDK?

Two different keys can map to the same 64-bit path in the current `HostState`
tree. Binding leaves to the full key hash prevents proof substitution but still
does not let those keys coexist. To investigate [#482](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/482)
we built an [IAVL prototype and cost comparison](https://github.com/cardano-foundation/cardano-ibc-incubator/blob/f75ac3992d3b9a0c0a158d491990888205b7ef80/experiments/hoststate-iavl/README.md)
using the [versioned tree used by Cosmos SDK](https://github.com/cosmos/iavl/tree/v1.2.2).
IAVL removes that routing limit but significantly increased execution cost in
our prototype. At 65,536 keys the two commitment updates needed for a send used
6.04 million memory units instead of 3.62 million, about 67% more. The signed
transaction shrank from 5,104 to 3,587 bytes. These measurements cover only the
commitment updates and exclude the other bridge validators.

Applying that measured cost increase to the existing first native send fixture
at 64 commitments raises its 15.94 million memory units to a projected 18.36
million against Cardano mainnet's 16.50 million per-transaction memory limit.
The benchmark uses the same limit, checked against the
[live mainnet protocol parameters](https://api.koios.rest/api/v1/cli_protocol_params)
on 2026-09-29.
That is a projection from separate benchmarks, not an integrated IAVL send test.
The compressed collision-bucket prototype projects 16.20 million and preserves
existing roots by allowing colliding keys to share an outer leaf. Its narrow
margin still needs integrated testing. These results favor further work on
collision buckets.

Our current tree, and the proposed collision buckets, can be reconstructed from the complete current key/value set. Insertion order does not matter. The same entries produce the same root.

With IAVL, the root also depends on tree structure and node versions, which reflect the update history. Inserting those same entries into a fresh IAVL tree can produce a different root.

So IAVL recovery needs either a snapshot preserving that structure and those versions, or replay of the exact updates and version boundaries.

## Why is voucher denom trace mapping on-chain, but still outside HostState?

Because the security roles are different.

Voucher trace lookup now lives on-chain because Cardano apps need a canonical
way to reverse a voucher asset hash into the original full denom trace without
depending on a Gateway database. However, that lookup data is still not part of
the IBC proof root exposed to counterparties.

`HostState` remains reserved for consensus-relevant IBC state: clients,
connections, channels, packet commitments, and the commitment root selected by
the active Cardano light client and used for ICS-23 verification. Voucher trace
mappings are Cardano-local lookup metadata.
Keeping them in a separate registry avoids bloating the IBC proof root and avoids
making counterparties care about local voucher reverse-lookup state.

The trace registry is still protected on-chain:

- only real voucher mint transactions can create first-seen entries
- the full denom must hash to the voucher token name exactly
- mappings are append-only and immutable once recorded

So the registry is canonical for Cardano-side correctness, while `HostState`
remains canonical for cross-chain verification.

## Why don't all wallets automatically show a friendly voucher name?

The registry solves correctness and reversibility, not universal presentation.

A generic Cardano wallet usually sees only the asset unit: policy id plus hashed
token name. To display a friendly name, the wallet needs to resolve the on-chain
registry or consume metadata derived from it. Our dapps and SDKs can do that, but
third-party wallets will only show better names if they choose to integrate that
resolution path.

## Can a counterparty verify that a packet receipt exists?

The Cardano Go light clients support only non-membership proofs for packet
receipts under the current commitment codec. `VerifyIbcStateMembership` rejects
`receipts/ports/` keys in the probabilistic v8 and v10 clients and the retired
Mithril v10 client.

Cardano stores an empty receipt bytestring and commits its CBOR encoding `0x40`.
ibc-go stores the receipt sentinel `0x01`. Unordered packet timeouts verify
receipt absence with `VerifyIbcStateNonMembership`. A committed `0x40` receipt
has a non-empty leaf hash so it cannot satisfy that absence proof.

Custom flows that need receipt membership require a coordinated commitment
codec change. [Issue #614](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/614)
tracks codec versioning and historical proof support. Until then the existing
receipt bytes and roots stay unchanged.

## Why can finalized packet history be pruned without keeping an off-chain copy?

Pruning removes only finalized destination history: a receipt and
acknowledgement pair from an unordered channel, or an acknowledgement from an
ordered channel. Ordered channels do not store receipt entries; their monotonic
`next_sequence_recv` counter prevents the same sequence from being received
again. Unresolved outbound packet commitments remain on-chain. Before allowing
deletion, Cardano verifies at a sufficiently new authenticated counterparty
height that the corresponding source commitment no longer exists, then
atomically raises the channel's on-chain receive-proof floor so an older
membership proof cannot replay the packet.

Packet sequences advance monotonically, so a resolved commitment for that
sequence cannot later be recreated. The proof floor, sequence counters,
remaining commitments, and commitment root all remain in live on-chain datums,
which means a fresh Gateway can reconstruct the current proof tree from chain
state alone without relying on a unique Gateway database, relayer, or historical
off-chain copy.

Hermes uses `packet_executor_concurrency = 4` by default to execute funded batches across independent channels while each channel has at most one batch in flight. Set it to `1` for serial execution. Increasing it needs separate signer inputs for fees and collateral. Shared initialization inputs and busy wallet inputs still cause retries. The send builder still includes at most two intents in each transaction. Measure drain time on the intended network before claiming a throughput gain.

Funded intent execution does not schedule pruning. Operators must monitor each active transfer channel with `GET /api/packet-history/channel-0/occupancy`. The response reports occupancy at one settled Cardano height. Alert on failed queries and any lane with `maintenance_required: true`. The flag starts at 48 of 64 entries. Each receive uses two entries. Poll often enough that traffic and indexing delay cannot consume the remaining receive slots before maintenance runs.

`prune_candidates` lists stored receipt and acknowledgement pairs. A candidate still needs authenticated source commitment absence. Relay its acknowledgement to the source first. Then use the source channel paired with this Cardano channel:

```sh
hermes --config "$HERMES_CONFIG" tx packet-prune \
  --dst-chain "$CARDANO_CHAIN_ID" \
  --src-chain "$SOURCE_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$SOURCE_CHANNEL_ID" \
  --sequence "$SEQUENCE"
```

Hermes obtains the proof and signs and submits the pruning transaction. With a connection delay use `--proof-height REVISION-HEIGHT` for a matured authenticated height that meets the receive high-water mark and pruning floor. Submit maintenance serially for a lane. Wait for inclusion and indexing before polling again. Continue until the alert clears. If there are no history pairs to prune the lane may need outgoing acknowledgements or timeouts instead. Reduce incoming traffic if maintenance cannot keep pace.

## Why was Mithril removed from the maintained path?

The retired Mithril client used periodic transaction-snapshot certificates as a
portable trust anchor. Certificate cadence and distance from the chain tip made
that design unsuitable for the latency expected from the maintained bridge
path. New deployments use the experimental `08-cardano-probabilistic` client,
which trades the portable Mithril certificate chain for configurable settlement
heuristics and stronger observer/data-source assumptions. The old design and
its operational tradeoffs remain in
[Mithril Light Client Design](mithril-light-client.md) as historical reference.
