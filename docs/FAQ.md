# FAQ

## What happens if the Cardano contract deployer key is compromised?

The attacker can spend funds held directly by that wallet and exercise the deployer's administrative permissions. The deployer alone cannot enter shutdown. Entry requires the current deployer and the governance quorum with no pending proposal or active migration. It immediately stops new work and starts a grace period of at least 24 hours and at least the governance delay.

Existing packet settlement and voucher returns can continue while their dependencies remain available. Cleanup requires the grace period to pass and the relevant state to be drained. Finalization requires zero live clients, connections and channels and removal of the drained transfer registration. These checks do not settle packets or refund users automatically.

Governance can nominate a replacement deployer through the existing delayed proposal process. Emergency signers can restrict affected operations while governance responds. See [authority and shutdown procedures](state-preserving-redeployment.md).

## What happens if the deployer key is lost?

Ordinary packet traffic and permissionless heartbeats do not need the deployer key. Governance can nominate and activate a replacement after its configured delay. There is no separate backup-key deployment mode. Funds held directly by the lost-key wallet remain inaccessible.

Shutdown is irreversible. Its deadline does not destroy HostState automatically. Remaining settlement paths can continue while their state and scripts remain available. If the deployer key is lost during shutdown, governance can replace the deployer before administrative cleanup resumes.

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
`receipts/ports/` keys in the probabilistic v8 and v10 clients.

Cardano stores an empty receipt bytestring and commits its CBOR encoding `0x40`.
ibc-go stores the receipt sentinel `0x01`. Unordered packet timeouts verify
receipt absence with `VerifyIbcStateNonMembership`. A committed `0x40` receipt
has a non-empty leaf hash so it cannot satisfy that absence proof.

Custom flows that need receipt membership require a coordinated commitment
codec change. [Issue #614](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/614)
tracks codec versioning and historical proof support. Until then the existing
receipt bytes and roots stay unchanged.

## Does ICS-20 packet history need pruning?

No. Receipts and acknowledgement hashes remain authenticated by each lane's
fixed-size Merkle root. They do not accumulate in the live datum or consume
receive capacity. Packet lanes have no receipt-pruning operation or recurring
cleanup transaction.

The Gateway reconstructs proofs from canonical Yaci transaction history. Its
SQLite checkpoints are disposable caches. Keep the canonical transaction history
available when restarting or moving a Gateway. Outstanding sends still occupy
live commitment slots until acknowledgement or timeout processing completes.

Interchain-query packets still store receipts and acknowledgements in the channel
datum and use a separate authenticated cleanup operation. The Gateway rejects
pruning requests for the ICS-20 `transfer` port.

The Cardano funded-intent executor runs only when `mode.packets.enabled = true`. It applies the Cardano chain's `packet_filter` channel policy before building or signing batches. Subscribing to chain events alone does not enable packet execution.

Hermes uses `packet_executor_concurrency = 4` by default to execute funded batches across independent channels while each channel has at most one batch in flight. A healthy channel can start its next batch while another channel is awaiting inclusion. Failed or idle attempts back off for five seconds. Timed-out submissions retain their signed transaction for reconciliation before another batch is built on that channel. Set it to `1` for serial execution. Increasing it needs separate signer inputs for fees and collateral. Shared initialization inputs and busy wallet inputs still cause retries. The send builder still includes at most two intents in each transaction. Measure drain time on the intended network before claiming a throughput gain.

## Why was Mithril removed from the maintained path?

The retired Mithril client used periodic transaction-snapshot certificates as a
portable trust anchor. Certificate cadence and distance from the chain tip made
that design unsuitable for the latency expected from the maintained bridge
path. New deployments use the experimental `08-cardano-probabilistic` client,
which trades the portable Mithril certificate chain for configurable settlement
heuristics and stronger observer/data-source assumptions. The Mithril client
has since been removed. Its design and operational tradeoffs are described in
[`docs/mithril-light-client.md` at `08bb4386`](https://github.com/cardano-foundation/cardano-ibc-incubator/blob/08bb438615cc9c0d6bbb06738aabb760a98df088/docs/mithril-light-client.md).
