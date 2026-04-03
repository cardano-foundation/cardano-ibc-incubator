# FAQ

## Why is voucher denom trace mapping on-chain, but still outside HostState?

Because the security roles are different.

Voucher trace lookup now lives on-chain because Cardano apps need a canonical
way to reverse a voucher asset hash into the original full denom trace without
depending on a Gateway database. However, that lookup data is still not part of
the IBC proof root exposed to counterparties.

`HostState` remains reserved for consensus-relevant IBC state: clients,
connections, channels, packet commitments, and the commitment root proven with
Mithril and ICS-23. Voucher trace mappings are Cardano-local lookup metadata.
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

## Why is Mithril slow? What determines its speed?

Mithril’s original motivation is safe checkpointing for bootstrapping nodes. So a new node can jump close to the chain tip using a certificate and then sync the remaining few blocks normally which is pretty fast. That biases the protocol toward issuing certificates periodically rather than per block, and toward staying some distance behind the tip (a finality buffer) so certificates are not invalidated by short-range rollbacks. Those choices look slow from an IBC perspective but they are safety and performance tradeoffs that are deliberately made by the Mithril team, they are not arbitrary delays or some computation time for example.  In local development we can tune Mithril aggressively because we control the local signers and aggregator, but in production the certificate cadence and finality buffer are properties of the network’s Mithril configuration and cannot be unilaterally sped up by the relayer or the Gateway. We are exploring other options to get transaction times on the order of seconds or less for the production implementation. 
