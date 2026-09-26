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

## Why was Mithril removed from the maintained path?

The retired Mithril client used periodic transaction-snapshot certificates as a
portable trust anchor. Certificate cadence and distance from the chain tip made
that design unsuitable for the latency expected from the maintained bridge
path. New deployments use the experimental `08-cardano-probabilistic` client,
which trades the portable Mithril certificate chain for configurable settlement
heuristics and stronger observer/data-source assumptions. The old design and
its operational tradeoffs remain in
[Mithril Light Client Design](mithril-light-client.md) as historical reference.
