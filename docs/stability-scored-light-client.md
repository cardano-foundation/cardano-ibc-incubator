## Stability-Scored Light Client Design

Author: Julius Tranquilli, https://github.com/floor-licker

Date: April 7, 2026

Personally I am framing "the Cardano light client problem" in 2026 as:

You can have at most two of these three:

1. fast acceptance
2. no external trust
3. no native consensus verification

i.e, If you insist on fast acceptance and do not want to implement native Cardano verification on Cosmos, then you are left with some form of external trust. So that means your options are:

1. trust Mithril,
2. trust your own small committee / pinned operators,
3. or trust a single Gateway / operator.

This document introduces a Cardano "stability-weighted" light client. It is implemented as client type `08-cardano-stability`. This is as an alternative to the Mithril light client. This model is not a fast finality model or anything of that nature, rather it tries to heuristically attain faster IBC proofs by making certain risk tradeoffs via a heuristic notion of Cardano settlement.

This is because the Mithril light client was effectively non-viable from a UX perspective. For example, Mithril certificates lagged the chain tip by over 100 blocks, so basic IBC operations would end up taking 200+ Cardano blocks.

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

But the security model is still probabilistic and not based around finality. If the heuristic accepts a Cardano fork that is later rolled back, standard IBC gives no clean way to rewind the counterparty state that already acted on that proof, and to be clear that is not something Mithril solved either. So at the time of writing, this should be understood as an experimental fast-settlement client, which could at some point be tuned further closer to finality, but not as “true Cardano finality”. When Cardano finality times do reach <5 minutes, this style of light client should be well positioned to benefit from that.

## Move from Mithril

The Mithril client is currently the main Cardano IBC client in this repo because Mithril provides a portable cryptographic artifact that the counterparty chain can verify on-chain, and it's also an inherently quorum attested mechanism which is useful for our purposes.

The downside is latency, Mithril certification lags the Cardano tip and is produced at a cadence that is acceptable for checkpointing and fast bootstrap, but bad for IBC UX.

The stability-scored client explores a different tradeoff:

- lower latency
- acceptance based on raw Cardano chain history plus a stake-weighted heuristic

That tradeoff comes with some weaker semantics:

- no cryptographic "finality" certificate (a mithril certificate is not finality)
- no clean rollback recovery in standard IBC if accepted Cardano history is later rolled back
- a weaker trust anchor than Mithril, because acceptance is based on a heuristic over block history and stake observations rather than a Mithril certificate chain
- more operational dependence on the quality of the block-history and epoch-stake data source

## High-Level Model

The model starts with an anchor block at height `H`. The client then looks at a contiguous descendant window of later Cardano blocks at heights `H+1`, `H+2`, ..., `H+k`.

For those descendants, the client computes:

- descendant depth
- number of distinct slot leaders / stake pools that produced descendants
- total unique stake weight of those pools, using a trusted epoch stake snapshot

The block at `H` is accepted only if all configured thresholds are met:

- threshold depth
- threshold unique pools
- threshold unique stake basis points

Separately, the client computes a score in basis points for observability and policy:

```text
score =
  depth_weight_bps * min(1, depth / threshold_depth) +
  pools_weight_bps * min(1, unique_pools / threshold_unique_pools) +
  stake_weight_bps * min(1, unique_stake_bps / threshold_unique_stake_bps)
```

with the weighted result normalized back into a `0..10000` basis-point range.

In the current implementation, the default thresholds are:

- `threshold_depth = 24`
- `threshold_unique_pools = 5`
- `threshold_unique_stake_bps = 8000`
- weights:
  - `depth_weight_bps = 2000`
  - `pools_weight_bps = 2000`
  - `stake_weight_bps = 6000`

These defaults are not special from a consensus perspective, they are just the initial policy the Gateway uses when constructing a new client.

## State Model

### ClientState

The stability `ClientState` stores:

- `chain_id`
- `latest_height`
- `frozen_height`
- `current_epoch`
- `trusting_period`
- `heuristic_params`
- `upgrade_path`
- `host_state_nft_policy_id`
- `host_state_nft_token_name`
- `epoch_contexts`

Each `EpochContext` carries:

- `epoch`
- `stake_distribution`
- `epoch_nonce`
- `slots_per_kes_period`
- `epoch_start_slot`
- `epoch_end_slot_exclusive`

For compatibility, the current epoch context is still mirrored into the legacy single-epoch fields, but the authoritative verification source is now the stored `epoch_contexts` set. That means the Cosmos-side verifier is not supposed to trust a relayer to tell it the scoring rule or the active epoch verification material on every update; the rule is in client state, and adjacent epoch rollover appends the next epoch context as part of a normal header update.

### ConsensusState

The stability `ConsensusState` stores:

- `timestamp`
- `ibc_state_root`
- `accepted_block_hash`
- `accepted_epoch`
- `unique_pools_count`
- `unique_stake_bps`
- `security_score_bps`

This follows the normal IBC intuition: consensus state is the per-height authenticated view that later membership and non-membership proofs verify against. The score is still stored for observability, but acceptance is governed by the hard thresholds for depth, unique pools, and unique stake, not by a relayed score match.

### Header

The `StabilityHeader` carries:

- `trusted_height`
- `bridge_blocks`
- `anchor_block`
- `descendant_blocks`
- `host_state_tx_hash`
- `host_state_tx_output_index`
- `new_epoch_context` when the anchor rolls into `epoch N+1`

The important thing to notice is that the header does **not** try to prove arbitrary Cardano ledger state. Just like the Mithril path, it is still centered around the Cardano `HostState` transaction/output that contains the `ibc_state_root`. The new part is that `trusted_height` is now real: `bridge_blocks` must connect the already-trusted consensus block hash at `trusted_height` to the new `anchor_block`, and only the post-anchor `descendant_blocks` are used for the stability score.

The header no longer carries relayed score metrics or a relayed HostState transaction body. The verifier recomputes the stability metrics locally for storage/telemetry, and it recovers the HostState transaction body directly from the authenticated anchor block witness before extracting `ibc_state_root`. On an adjacent epoch rollover update, the header also carries the authenticated epoch context for the new anchor epoch so the client can continue on the same client ID without operational redeployment.

Each relayed `StabilityBlock` now also carries raw `block_cbor`. The verifier decodes that raw Cardano block witness and cross-checks the claimed block hash, previous hash, height, slot, and issuer pool identity before it accepts the bridge or descendant window as the basis for scoring.

### Latest Height

In stability mode, `latestHeight` is no longer latest Mithril transaction snapshot height. Instead it means the latest Cardano block height at which the currently live `HostState` root is considered stability-accepted under the configured heuristic.

The Gateway:

1. finds the current live HostState UTxO
2. finds the Cardano block that created that HostState transaction
3. loads descendant blocks after that height
4. loads epoch stake distribution for that block’s epoch
5. computes the stability metrics
6. refuses to serve that height unless the thresholds are met

### New Client

`QueryNewClient` in stability mode constructs a `ClientState` and `ConsensusState` for a chosen Cardano height by:

1. loading the anchor block at the requested height
2. loading its descendant window
3. loading epoch stake distribution
4. computing the score and enforcing the thresholds
5. locating the HostState UTxO at or before that height
6. decoding the HostState datum and extracting `ibc_state_root`
7. serializing the stability client state and consensus state

Client creation still starts from one epoch context, but updates are no longer single-epoch-only. Gateway now supports ordinary `epoch N -> epoch N+1` rollover updates on the same client ID by attaching `new_epoch_context` to the header when the anchor moves into the next epoch. The scored descendant window still remains single-epoch: bridge continuity may span the boundary, but the anchor and scored descendants must all live in the same anchor epoch.

### IBC Header

`QueryIBCHeader` in stability mode returns a `StabilityHeader` rather than a Mithril header. The request now includes both `trusted_height` and `height`, and the returned header includes:

- `bridge_blocks` from `trusted_height + 1` up to `anchor_block.height - 1`
- the `anchor_block` whose HostState transaction/output will define the new consensus state
- the `descendant_blocks` used to justify accepting that anchor under the configured thresholds
- the raw `block_cbor` witness for every bridge, anchor, and descendant block
- the HostState transaction hash and output index needed to recover `ibc_state_root` from the authenticated anchor block
- `new_epoch_context` if and only if the anchor is in `trusted_epoch + 1`

### Proof Height Gating

The proof-serving endpoints that return ICS-23 proofs still build proofs from the live in-memory IBC tree, so they must only advertise a proof height once the live root is acceptable for the selected Cardano client mode.

In stability mode, the proof-height resolver now uses the same threshold logic as `QueryNewClient` and `QueryIBCHeader`; it no longer uses the earlier placeholder rule of “the HostState block has at least one descendant”, and it no longer rejects a still-live prior-epoch HostState root merely because the chain has rolled into the next epoch.

## Cosmos-Side Verification Flow

The Cosmos-side client is implemented under:

- [x/clients/stability](/Users/juliustranquilli/webisoft/cardano-ibc-official/cosmos/entrypoint/x/clients/stability)

The high-level update flow is:

1. verify the header shape (`anchor_block`, `host_state_tx_hash`, etc.)
2. require the new header to be strictly newer than the current client height
3. load the stored consensus state at `trusted_height`
4. verify continuity from previously trusted state:
   - if `bridge_blocks` is empty, `anchor_block.prev_hash` must equal the trusted consensus `accepted_block_hash`
   - otherwise the first `bridge_block.prev_hash` must equal the trusted consensus `accepted_block_hash`
   - each bridge block must increment height by exactly one and chain by hash
   - `anchor_block.prev_hash` must equal the last bridge block hash
5. verify the descendant chain is contiguous:
   - each descendant’s `prev_hash` must match the prior block’s hash
   - each descendant height must increment by exactly one
6. recompute:
   - distinct pools
   - unique stake basis points
   - security score
7. enforce the configured thresholds from `ClientState.HeuristicParams`
8. locate the HostState transaction inside the authenticated anchor block, locate the HostState output by NFT, and extract `ibc_state_root`
9. write a new consensus state for the accepted anchor height

The extracted `ibc_state_root` is then used for ordinary IBC membership and non-membership verification.

This is stronger than the earlier version of the stability client because the verifier no longer treats normalized history rows as ground truth. It authenticates the relayed raw block witness bytes first, and only then uses those authenticated blocks as the basis for continuity and stability scoring.

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

An implementation detail worth calling out: the current stability client reuses some existing Mithril helper logic for HostState datum decoding and ICS-23 proof verification. That is fine architecturally because the proof model is the same; only the trust anchor used to authenticate the root is changing.

## Hermes Integration

Hermes now understands the stability client as a first-class Cardano client type:

- `08-cardano-stability`

The relayer-side changes do two things:

1. add new type support in the relayer type system for:
   - client state
   - consensus state
   - header
2. generalize the Cardano endpoint so it can work with either:
   - Mithril headers / states
   - stability headers / states

This means the Cardano endpoint no longer hardcodes Mithril-only header and consensus-state types when it talks to the Gateway.

## Tuning Parameters

The current tuning inputs are:

- `CARDANO_STABILITY_THRESHOLD_DEPTH`
- `CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS`
- `CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS`
- `CARDANO_STABILITY_DEPTH_WEIGHT_BPS`
- `CARDANO_STABILITY_POOLS_WEIGHT_BPS`
- `CARDANO_STABILITY_STAKE_WEIGHT_BPS`

Today these are chosen off-chain by the Gateway environment before `QueryNewClient` is used, and then serialized into the new client’s `ClientState`. After that, normal header updates do not retune them. So in practice, for a given instantiated client, they are immutable unless a new client is created or a future client-upgrade mechanism is introduced.

## Current Limitations And Open Questions

### 1. Epoch stake rotation is only partially solved

The client now supports in-place adjacent rollover by storing multiple `epoch_contexts` in client state and accepting an authenticated `new_epoch_context` on an `epoch N -> epoch N+1` update. That is enough to avoid per-epoch client redeployment, but it is still not a full arbitrary historical epoch-context protocol.

### 2. Updates are no longer within-epoch only, but they are still adjacent-epoch only

The current implementation allows bridge continuity across one epoch boundary, but it still fails closed if the client misses more than one epoch without an update. In other words, `N -> N+1` works, while `N -> N+2` and beyond is intentionally unsupported for now.

### 3. Missing epoch stake data now fails closed

The current implementation no longer falls back to equal weights or relayed `stake_bps` values when epoch stake data is missing. Gateway refuses to construct stability evidence without a non-empty epoch stake snapshot, and the Cosmos-side verifier rejects any client or update whose active `epoch_context` has an empty or zero-weight stake distribution.

### 4. This is still not full native Ouroboros verification

The current implementation authenticates raw Cardano block witnesses well enough to stop trusting normalized history rows as ground truth, but it still does not verify the full Ouroboros rule set on-chain. In particular, epoch stake rotation, leader-eligibility verification across epochs, and other native consensus details remain future work.

### 5. Epoch verification context is now node-sourced and point-acquired, but still limited

The stability client no longer reads the epoch nonce or `slotsPerKesPeriod` from Gateway config. Instead, Gateway acquires Cardano local-state at a concrete block point through Ogmios and derives the epoch context from that acquired view. That is a stronger trust boundary than operator-provided config, but it is still not a full historical catch-up protocol because the client only accepts adjacent rollover updates.

### 6. The trust anchor is still weaker than Mithril

Mithril gives a portable cryptographic artifact that explicitly certifies a Cardano snapshot. The stability client does not. Instead it relies on `ledger.VerifyBlock(...)` plus authenticated raw Cardano block witnesses streamed from one configured node/Ogmios observer, and then applies a deterministic acceptance rule on-chain. That is materially stronger than trusting normalized history rows or relayed metadata, but it is still not a fully solved portable chain-authenticity story inside the client itself.
