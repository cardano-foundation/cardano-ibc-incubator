# FAQ

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

Pruning removes only a finalized receipt and acknowledgement pair from an
unordered channel; unresolved outbound packet commitments remain on-chain.
Before allowing deletion, Cardano verifies at a sufficiently new authenticated
counterparty height that the corresponding source commitment no longer exists,
then atomically raises the channel's on-chain receive-proof floor so an older
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
