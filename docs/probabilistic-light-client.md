## Probabilistic Light Client Design

Author: Julius Tranquilli, https://github.com/floor-licker

Date: April 7, 2026

I would "the Cardano light client problem" in 2026 as:

You can have at most two of these three:

1. fast acceptance
2. no external trust
3. no native consensus verification

i.e, If you insist on fast acceptance and do not want to implement native Cardano verification on Cosmos, then you are left with some form of external trust. So that means your options are:

1. trust Mithril,
2. trust your own small committee / pinned operators,
3. or trust a single Gateway / operator.

The probabilistic light client is implemented as client type `08-cardano-probabilistic`. This is an alternative to the deprecated Mithril light client, whose client type is `08-cardano-mithril`. This model is not a fast finality model or anything of that nature, rather it tries to heuristically attain faster IBC settlement by making certain risk tradeoffs via a heuristic notion of Cardano settlement. The exact parameters and thereby strength of the heuristic are tunable, and some are epoch context dependent.

The Mithril light client was effectively non-viable from a UX perspective. Simple IBC swaps/transfers would currently take hundreds of Cardano blocks under mainnet conditions.

I think it is worth clarifying as well that comparing this model to the Mithril-based light client is not just a question of "faster means weaker." For example, a large factor in the security of the Mithril model is Mithril network participation, which I believe at the time of writing is even less than 20% of the network. So we can imagine comparing two assertions like the following:

A) A randomly selected subset selected out of a pool of a fixed + hard, proportion of the network agree on the ledger view at a height H, so we consider it "final"

Note: by fixed + hard, I don't mean it can't increase, I mean it is not a tunable parameter, we can't control network participation.

or

B) A block that is `x` blocks deep, has been built on top of by at least `y` different stakepools representing at least `z`% of the overall network stake is considered "final".

This model is configurable, so the safety of trusting it is entirely dependent on the tuned parameters. Instead of waiting for a Mithril certificate chain, this client:

**treats a Cardano block as acceptable once a certain number of later Cardano blocks have been built on top of it, by a sufficiently diverse, and sufficiently large set of stake pools.**

The resulting decision is represented as a score plus hard acceptance thresholds, and that accepted block is then used as the height at which the Cardano `HostState` commitment root is authenticated for IBC.

This client is NOT equivalent to BFT finality, and it is NOT equivalent to a Tendermint-style light client. It is certainly a superior solution in terms of UX, but it does not currently offer a trust story comparable to a portable certification path like Mithril. Today it should be understood as a deterministic settlement heuristic over node-sourced Cardano block witnesses: the verifier now rejects malformed or internally inconsistent block witnesses and performs meaningful native-ish checks, but canonical history still comes from one configured node/Ogmios observer view.

It implements an IBC 02-client shape in the `ibc-go` v10 sense, meaning:

- custom `ClientState`
- custom `ConsensusState`
- custom `Header`
- custom misbehaviour type
- Cosmos-side light client module registration
- Hermes-side type plumbing
- Gateway support for latest height / new client / header queries

But the security model is still probabilistic and not based around finality. If the heuristic accepts Cardano history that is later reorganized out of the canonical chain, that is a safety failure for an IBC integration: standard IBC assumes accepted consensus history is not invalidated and has no mechanism to rewind counterparty state that already acted on that proof. To be clear, that is not something Mithril solved either. So at the time of writing, this should be understood as an experimental fast-settlement client, which could at some point be tuned further closer to finality, but not as “true Cardano finality”. When Cardano finality times do reach <5 minutes, this style of light client should be well positioned to benefit from that.

## Move from Mithril

The Mithril client was previously the main Cardano IBC client in this repo because Mithril provides a portable cryptographic artifact that the counterparty chain can verify on-chain, and it's also an inherently quorum attested mechanism which is useful for our purposes.

The downside is latency, Mithril certification lags the Cardano tip and is produced at a cadence that is acceptable for checkpointing and fast bootstrap, but bad for IBC UX.

The probabilistic client explores a different tradeoff:

- lower latency
- acceptance based on raw Cardano chain history plus a stake-weighted heuristic

That tradeoff comes with some weaker semantics:

- no cryptographic "finality" certificate (a mithril certificate is not finality)
- accepted Cardano history later being reorganized out would be a safety failure for an IBC integration, not a recoverable IBC event
- a weaker trust anchor than Mithril, because acceptance is based on a heuristic over block history and stake observations rather than a Mithril certificate chain
- more operational dependence on the quality of the block-history and epoch-stake data source

## High-Level Model

The model starts with an anchor block at height `H`. The client then looks at a contiguous descendant window of later Cardano blocks at heights `H+1`, `H+2`, ..., `H+k`.

For those descendants, the client computes:

- descendant depth
- number of distinct slot leaders / stake pools that produced descendants
- qualified unique stake weight of those pools, using a trusted epoch stake snapshot
- whether those producing pools were first registered before the protocol cutoff

The block at `H` is accepted only if all configured thresholds are met:

- threshold depth
- threshold qualified unique pools
- threshold qualified unique stake basis points
- pool first-registration cutoff

Separately, the client computes a score in basis points for observability and policy:

```text
score =
  depth_weight_bps * min(1, depth / threshold_depth) +
  pools_weight_bps * min(1, qualified_unique_pools / threshold_unique_pools) +
  stake_weight_bps * min(1, qualified_unique_stake_bps / threshold_unique_stake_bps)
```

with the weighted result normalized back into a `0..10000` basis-point range.

In the current implementation, the finality thresholds are embedded in the light-client module:

- `threshold_depth = 24`
- `threshold_unique_pools = 5`
- `threshold_unique_stake_bps = 5000`
- weights:
  - `depth_weight_bps = 2000`
  - `pools_weight_bps = 2000`
  - `stake_weight_bps = 6000`

These defaults are not special from a consensus perspective, but they are consensus-critical for this light client implementation. They are not supplied by the Gateway and are not serialized into `ClientState`.

Pool age eligibility is not a tuning parameter. A descendant block producer only counts toward qualified unique pools and qualified unique stake if its first registration slot is before `2026-01-01T00:00:00Z`, meaning the pool started in 2025 or earlier. Total active stake is still the denominator for qualified unique-stake scoring, and missing first-registration data fails closed because the verifier cannot distinguish an old pool from an unknown one.

### 24-Block Unique-Stake Diagnostics

A cached 10-day Blockfrost mainnet study over epochs `629` and `630` measured how much unique stake appears in a 24-descendant-block range. The exact eligibility mode was not usable for this diagnostic because first-registration data was incomplete and exact mode intentionally fails closed. The table below is therefore the unfiltered sensitivity view: it shows the active stake represented by unique descendant-producing pools before applying the pool-registration cutoff rule.

Mainnet:

| percentile   | unique stake bps | percent stake |
| ------------ | ---------------: | ------------: |
| p10          |          442 bps |         4.42% |
| median       |          511 bps |         5.11% |
| p90          |          580 bps |         5.80% |
| p95          |          600 bps |         6.00% |
| p99          |          633 bps |         6.33% |
| max observed |          716 bps |         7.16% |

A two-epoch Blockfrost preprod study over epochs `287` and `288` measured the same 24-descendant-block range. Exact eligibility was available in this sample and matched the unfiltered result.

Preprod:

| percentile   | unique stake bps | percent stake |
| ------------ | ---------------: | ------------: |
| p10          |         5594 bps |        55.94% |
| median       |         6343 bps |        63.43% |
| p90          |         6995 bps |        69.95% |
| p95          |         7130 bps |        71.30% |
| p99          |         7361 bps |        73.61% |
| max observed |         7641 bps |        76.41% |

This is a useful sanity check for parameter selection: in the observed mainnet sample, 24 descendant blocks generally represented roughly 500 bps of unique active stake, not 5000 bps. In the observed preprod sample, the same 24-block range usually exceeded 5000 bps because stake was much more concentrated across the producing pools.

### Header

The `ProbabilisticHeader` carries:

- `trusted_height`
- `bridge_blocks`
- `anchor_block`
- `descendant_blocks`
- `host_state_tx_hash`
- `host_state_tx_output_index`
- `new_epoch_context` when the anchor rolls into `epoch N+1`

The important thing to notice is that the header does **not** try to prove arbitrary Cardano ledger state. Just like the Mithril path, it is still centered around the Cardano `HostState` transaction/output that contains the `ibc_state_root`. The new part is that `trusted_height` is now real: `bridge_blocks` must connect the already-trusted consensus block hash at `trusted_height` to the new `anchor_block`, and only the post-anchor `descendant_blocks` are used for the probabilistic score.

The header no longer carries relayed score metrics or a relayed HostState transaction body. The verifier recomputes the probabilistic metrics locally for storage/telemetry, and it recovers the HostState transaction body directly from the authenticated anchor block witness before extracting `ibc_state_root`. On an adjacent epoch rollover update, the header also carries the authenticated epoch context for the new anchor epoch so the client can continue on the same client ID without operational redeployment.

Each relayed `ProbabilisticBlock` now also carries raw `block_cbor`. The verifier decodes that raw Cardano block witness and cross-checks the claimed block hash, previous hash, height, slot, and issuer pool identity before it accepts the bridge or descendant window as the basis for scoring.

### Latest Height

In probabilistic mode, `latestHeight` is no longer latest Mithril transaction snapshot height. Instead it means the latest Cardano block height at which the currently live `HostState` root is considered probabilistic-accepted under the configured heuristic.

The Gateway:

1. finds the current live HostState UTxO
2. finds the Cardano block that created that HostState transaction
3. loads descendant blocks after that height
4. loads epoch stake distribution for that block’s epoch
5. computes the probabilistic metrics
6. refuses to serve that height unless the thresholds are met

### New Client

`QueryNewClient` in probabilistic mode constructs a `ClientState` and `ConsensusState` for a chosen Cardano height by:

1. loading the anchor block at the requested height
2. loading its descendant window
3. loading epoch stake distribution
4. computing the score and enforcing the thresholds
5. locating the HostState UTxO at or before that height
6. decoding the HostState datum and extracting `ibc_state_root`
7. serializing the probabilistic client state and consensus state

Client creation still starts from one epoch context, but updates are no longer single-epoch-only. Gateway now supports ordinary `epoch N -> epoch N+1` rollover updates on the same client ID by attaching `new_epoch_context` to the header when the anchor moves into the next epoch. The scored descendant window still remains single-epoch: bridge continuity may span the boundary, but the anchor and scored descendants must all live in the same anchor epoch.

An accepted epoch context is canonical for that epoch. Later headers may repeat the same epoch context, but a different context for an already-known epoch is treated as misbehaviour and freezes the client. This does not make the first accepted epoch context cryptographically authenticated; it changes the failure mode so that contradictory observer views cannot silently replace or coexist with the stored stake context.

## HostState Root Authentication

Just like the Mithril path, this client is **not** verifying arbitrary Cardano state directly. It is verifying a Cardano IBC-specific commitment architecture centered around the HostState UTxO.

The client:

1. authenticates the relayed anchor block witness
2. finds the transaction inside that block whose body hash equals `host_state_tx_hash`
3. loads the output at `host_state_tx_output_index`
4. verifies that output contains the expected HostState NFT
5. requires an inline datum on that output
6. decodes the datum and extracts `ibc_state_root`

That extracted root becomes the authenticated root in `ConsensusState`, and later ICS-23 proofs are checked against it.

The current probabilistic client reuses some existing Mithril helper logic for HostState datum decoding and ICS-23 proof verification. That is fine architecturally because the proof model is the same, only the trust anchor used to authenticate the root is changing.

## Finality Parameters

The current finality parameters are embedded in the light-client module:

- `threshold_depth = 24`
- `threshold_unique_pools = 5`
- `threshold_unique_stake_bps = 5000`
- `depth_weight_bps = 2000`
- `pools_weight_bps = 2000`
- `stake_weight_bps = 6000`

They are not supplied by the Gateway and are not serialized into `ClientState`.
