## Probabilistic Light Client Design

The client has one storage format. Small public records refer to shared authenticated snapshots and verification runs through bounded transactions. The wire marker is `storage_version = 2`. The former inline format is removed and version `0` is rejected. See [the storage and verification design](probabilistic-bounded-verification.md) for the resource bounds and twelve-hour response window.

Author: Julius Tranquilli, https://github.com/floor-licker

Date: April 7, 2026

I would describe "the Cardano light client problem" in 2026 as:

You can have at most two of these three:

1. fast acceptance
2. no external trust
3. no native consensus verification

i.e, If you insist on fast acceptance and do not want to implement native Cardano verification on Cosmos, then you are left with some form of external trust. So that means your options are:

1. trust Mithril,
2. trust your own small committee / pinned operators,
3. or trust a single Gateway / operator.

The probabilistic light client is implemented as client type `08-cardano-probabilistic`. It replaced the Mithril light client, client type `08-cardano-mithril`, which has been removed. This model is not a fast finality model or anything of that nature, rather it tries to heuristically attain faster IBC settlement by making certain risk tradeoffs via a heuristic notion of Cardano settlement. The exact parameters and thereby strength of the heuristic are tunable, and some are epoch context dependent.

The Mithril light client was effectively non-viable from a UX perspective. Under the cadence assumptions evaluated before that client was retired, simple IBC swaps or transfers could take hundreds of Cardano blocks.

Comparing this model to the Mithril-based light client is not just a question of "faster means weaker." A large factor in the security of the Mithril model is network participation, which is time-varying and must be supported by dated measurements rather than assumed as a constant. We can imagine comparing two assertions like the following:

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
- whether those producing pools were first registered more than six calendar months before the anchor

The block at `H` is accepted only if all configured thresholds are met:

- threshold depth
- threshold qualified unique pools
- threshold qualified unique stake basis points
- rolling pool first-registration cutoff

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
- `threshold_unique_stake_bps = 511`
- weights:
  - `depth_weight_bps = 2000`
  - `pools_weight_bps = 2000`
  - `stake_weight_bps = 6000`

These defaults are not special from a consensus perspective, but they are consensus-critical for this light client implementation. They are not supplied by the Gateway and are not serialized into `ClientState`.

Pool age eligibility uses a rolling six-calendar-month minimum. A descendant producer counts toward qualified unique pools and qualified unique stake only if its authenticated first registration is strictly before the verified anchor's time minus six calendar months. The subtraction uses UTC and preserves the time of day. If the target month lacks the anchor's day, it uses that month's last day. For example, an anchor on August 31, 2026 uses February 28, 2026 as the cutoff. A registration exactly at the cutoff does not qualify. The cutoff stays fixed for all descendants of that anchor. Replay and historical challenges use that historical anchor rather than the host clock or the latest checkpoint.

Gateway and the shared Go core calculate the same cutoff from the anchor and network timing. This allows newer pools to become eligible after waiting six months. It also allows an attacker to register identities in advance and wait out the age requirement. The rule does not authenticate claimed stake amounts. Total active stake remains the denominator for settlement credit. Missing authenticated registration data grants no qualification. The age requirement changes settlement credit rather than native block validity.

For settlement in epoch `e` the producer must also have produced at least one verified block in one of the five completed epochs `e-5` through `e-1`. Both the qualified-pool count and its stake credit require this history. A block produced in the current epoch cannot qualify its producer for that epoch. Native header validity continues to use the registered identity and submitted election stake regardless of this settlement qualification.

The client stores five completed-epoch bits and a separate current-epoch flag for each recently observed producer. Bit `0` represents `e-1` and bit `4` represents `e-5`. Only authenticated bridge blocks and anchors incorporated into a committed checkpoint set these observations. Production is recorded even for a producer that does not qualify for settlement. Repeated observations set the same flag once. At rollover the current flag moves into the completed window and older bits expire. Settlement descendants do not change saved history. A later committed anchor records those blocks when they become part of the accepted prefix. The completed window stays fixed throughout the epoch being evaluated.

Ordinary consensus states, rootless checkpoints and historical challenge checkpoints retain the history at their own block. Recovery copies the substitute checkpoint's history. Bootstrap requires authenticated observations or explicitly trusted production data at the initial chain point. During creation Gateway reads this from its configured history provider at the selected starting point. The operator trusts that initial snapshot. Missing history grants no qualification. Existing clients without the field need an authenticated migration or a trusted new bootstrap.

Settlement counts each qualifying producer once using `q_i = min(p_i, r_i + c)`. Here `p_i` is the pool's submitted current stake divided by submitted total active stake. The retained share `r_i` starts from the explicitly trusted bootstrap distribution. The additional allowance `c` is currently an experimental `50` basis points, or `0.5` percentage points. A pool with a reference share of `0.02%` that claims `20%` therefore contributes `0.52%` toward settlement. Decreases reduce credit immediately. Discounts are never normalized back to `100%`. Exact fractions are added before converting the combined credit to basis points.

At each adjacent epoch transition the client sets the next reference to the previous epoch's capped credits for all pools. It does not copy the submitted shares or grant another allowance on each update. Pools without a retained reference start at zero. The reference is stored with each checkpoint and retained consensus state so historical challenge verification uses the reference from that point in history. A missing reference requires an explicitly authenticated migration or a trusted new bootstrap. Recovery through an explicitly trusted substitute also installs that substitute's reference.

The existing `24` descendant, `5` qualifying pool and `511` basis point requirements still apply. Header leader checks still use the submitted native stake shares. A large increase changes settlement credit rather than invalidating the producer's block or automatically rejecting its epoch. The Gateway uses the destination client's reference to look for enough descendants. Insufficient evidence leaves the update pending. This rule limits inflation per pool in one epoch. It deliberately allows gradual inflation as the reference advances and an attacker can also spread credit across more eligible identities. It does not authenticate the submitted stake amounts.

Client-specific Gateway queries use the destination's saved production history and credit reference. They apply bridge and anchor observations for evidence selection and request more descendants when necessary. Standalone proof-height discovery uses indexed block observations as an estimate. Those observations cannot initialize or replace the client's production history. The Go verifier always derives history from its own checkpoint and authenticated blocks.

### 24-Block Unique-Stake Diagnostics

A mainnet study over epochs `629` and `630` measured how much unique stake appears in a 24-descendant-block range.  The table below shows the active stake represented by unique descendant-producing pools before applying the pool-registration cutoff rule.

Mainnet:

| percentile   | unique stake bps | percent stake |
| ------------ | ---------------: | ------------: |
| p10          |          442 bps |         4.42% |
| median       |          511 bps |         5.11% |
| p90          |          580 bps |         5.80% |
| p95          |          600 bps |         6.00% |
| p99          |          633 bps |         6.33% |
| max observed |          716 bps |         7.16% |

A two-epoch Blockfrost preprod study over epochs `287` and `288` measured the same 24-descendant-block range.

Preprod:

| percentile   | unique stake bps | percent stake |
| ------------ | ---------------: | ------------: |
| p10          |         5594 bps |        55.94% |
| median       |         6343 bps |        63.43% |
| p90          |         6995 bps |        69.95% |
| p95          |         7130 bps |        71.30% |
| p99          |         7361 bps |        73.61% |
| max observed |         7641 bps |        76.41% |

This is a useful sanity check for parameter selection: in the observed mainnet sample, 24 descendant blocks generally represented roughly 511 bps of unique active stake, so the embedded stake threshold is set to that mainnet median. In the observed preprod sample, the same 24-block range usually exceeded 5000 bps because stake was much more concentrated across the producing pools.

It's clear from these diagnostics that Preprod has far fewer active/producing pools, and stake is much more concentrated among the pools that produce blocks. So a short 24-block window samples pools that represent a much larger fraction of total active stake. We can see that in preprod, in approximately 90% of cases, we would reach 5000 bps unique stake well before the 24-block window is over, whereas on mainnet we would be lucky to get **500** unique stake bps in a 24 block window. The observed median was 511 bps. This means if we configure our unique stake threshold to around 511 bps, then about 50% of the time we will reach heuristic settlement ("finality") in 24 blocks ( it will actually be less than 50% of the time as we then need to qualify the unique stake which will increase the timeline further).

Also note that this conversation takes place before our **qualified** unique stake application, i.e, we actually only sum unique stake from pools created prior to 2026.

The [mainnet stake distribution study from October 9, 2026](../studies/cardano_probabilistic_finality/mainnet-stake-2026-10-09/) examines 100 epoch transitions and replays recent-production qualifications against the current 24-descendant, five-pool and 511-basis-point policy. It measures how limits on stake changes could restrict fabricated allocations and how production qualifications affect settlement time. These restrictions do not authenticate stake amounts.

That study used the earlier fixed January 2026 registration cutoff. It does not measure the availability impact of the rolling six-month requirement.

### Header

Gateway returns logical observation evidence with the following fields. Hermes commits that evidence through `observation_chunk` operations. A full logical header cannot execute as a client update. The logical evidence carries:

- `trusted_height`
- `bridge_blocks`
- `anchor_block`
- `descendant_blocks`
- `host_state_tx_hash`
- `host_state_tx_output_index`
- `new_epoch_context` when the anchor rolls into `epoch N+1`
- `is_checkpoint` (proto field 12): rootless checkpoints advance trusted block
  tracking and renew client expiry without extracting a HostState root or
  creating an IBC consensus state. Checkpoint headers leave `host_state_tx_hash`
  empty and `host_state_tx_output_index` at zero.

Client expiry uses the latest committed checkpoint's authenticated block time. A forward update must arrive before that checkpoint's trusting period ends. An epoch table proposal alone does not renew expiry. Temporary descendants do not renew it either. Checkpoints leave existing proof roots, timestamps and delay metadata unchanged. A checkpoint height cannot be used for membership proofs, absence proofs or packet timeouts because it has no IBC consensus state. This behavior requires the updated Cosmos client code but no new protobuf fields.

The important thing to notice is that the header does **not** try to prove arbitrary Cardano ledger state. Just like the Mithril path, it is still centered around the Cardano `HostState` transaction/output that contains the `ibc_state_root`. The new part is that `trusted_height` is now real: `bridge_blocks` must connect the already-trusted consensus block hash at `trusted_height` to the new `anchor_block`, and only the post-anchor `descendant_blocks` are used for the probabilistic score.

The header no longer carries relayed score metrics or a relayed HostState transaction body. The verifier recomputes the probabilistic metrics locally for storage/telemetry, and it recovers the HostState transaction body directly from the authenticated anchor block witness before extracting `ibc_state_root`. On an adjacent epoch rollover update, the header also carries the authenticated epoch context for the new anchor epoch so the client can continue on the same client ID without operational redeployment.

Each relayed `ProbabilisticBlock` carries the evidence its role needs. A root-bearing `anchor_block` carries full `block_cbor` so the verifier can authenticate the HostState transaction against the signed block body, and full bridge bodies and checkpoint anchors authenticate certificate and packet transitions. Settlement descendants can carry only `header_cbor`. The verifier derives the signed block metadata from that evidence and cross-checks the claimed block hash, previous hash, height, slot, and issuer pool identity before accepting the update.

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

Use the ordinary Hermes client creation command. Gateway prepares initial state at the requested Cardano height or its current indexed point. That point must contain the bridge instance's HostState UTxO. The operator trusts the configured node and history providers for initialization. Hermes submits `MsgCreateClient` and automatically finishes the bounded imports. No bootstrap file is required. The creation records contain references only and pending imports resume at the same checkpoint. The final import certifies the bootstrap table with Mithril. Proof use requires a completed host block after that commitment cutoff without a twelve-hour stake challenge.

An observation may cross one epoch boundary from its trusted checkpoint. A future table without matching Mithril certification starts a twelve-hour response window when its verified receipt is activated. Until that window and a subsequent committed host block have passed, an observation using that epoch cannot advance the checkpoint or publish a proof root. Qualification remains positioned at the anchor. Temporary descendants advance working verification state only. The committed checkpoint retains the anchor's nonce, registry, production and certificate counters.

The client derives a block's epoch from its signed slot and the stored current
epoch boundaries. Those boundaries provide the network's epoch length and slot
offset for the supported Babbage and Conway eras. At rollover the client computes
the next boundaries from that stored schedule. The protobuf still carries
`epoch`, `epoch_start_slot`, `epoch_end_slot_exclusive`, and
`slots_per_kes_period`, but their values must exactly match the client's schedule
and KES configuration. A relayer cannot change those values through an update.
The initial epoch boundaries remain part of the trusted bootstrap configuration.
An era that changes the epoch schedule needs an authenticated schedule transition
before this verifier can support it.

The client also derives each next epoch nonce from verified headers. Its
checkpoint stores the evolving nonce, candidate nonce, previous-block hash nonce
and saved epoch block nonce together with the current epoch nonce. At rollover it
combines the old candidate and saved epoch block nonce before verifying the first
header. It then advances the saved epoch block nonce. Every verified VRF output
updates the evolving nonce using Cardano's nonce hashing rules. The candidate
copies it only when the header slot plus the configured randomness window is
strictly before the next epoch start.

Bridge blocks and the anchor advance the stored nonce state. Settlement
descendants advance a temporary copy so the next update can process them again
from the anchor. Retained consensus states and challenge checkpoints keep their
own nonce state. The compatibility field `new_epoch_context.epoch_nonce` must
match the locally derived value. An incorrect nonce rejects an update. It does
not by itself count as misbehaviour or become accepted after the challenge delay.

Bootstrap requires an explicitly trusted starting checkpoint with all these
running values. The checkpoint provider must obtain the running values at that exact point. The epoch nonce alone is insufficient. Operators
must set `CARDANO_RANDOMNESS_STABILISATION_WINDOW_SLOTS` from the network's
protocol rules. The supported Praos rules use `3*k/f` for Babbage and `4*k/f` for
Conway. A transition that changes this rule requires an authenticated client
configuration change before synchronization can continue. Existing clients
without running nonce state need an explicit authenticated migration or a new
bootstrap. The current epoch nonce alone cannot fill in the missing values.

An installed stake allocation remains canonical for forward updates in its epoch.
A different unsigned allocation rejects a normal update. Only incompatible
verified settled histories can freeze the client. The first supplied stake distribution still uses the challenge
model described below.

The static local Caribic devnet explicitly sets
`CARDANO_STABILITY_ASSUME_STATIC_STAKE=1`. With that opt-in, Gateway normalizes
the Ogmios 6.12 live fractions across the positive-stake pool set because Ogmios
reports each pool relative to total ledger stake, including stake that is not
delegated to a pool. This gives the local Praos check active delegated stake,
but it is not an epoch-frozen leader-election snapshot. The flag is only safe
for a static local devnet and is removed when Caribic configures a public
network. Public deployments use the configured current-epoch and historical
stake snapshot sources and must not enable this fallback when delegations can
change.

## Epoch Context Challenge Window

Only an uncertified stake distribution starts the twelve-hour response window. It budgets bounded evidence verification and challenge submission. Repeated proposals do not reset it. Host interruptions pause the unfinished window without resetting elapsed observation time. They do not impose another wait on certified or already cleared allocations. Both activation and proof verification require a completed host block after the allocation's own cutoff. A matching Mithril certificate removes any remaining stake wait. Bootstrap requires certification. Authorized recovery adopts a usable substitute without starting a new stake window.

Hermes checks the exact requested proof root before waiting for an epoch proposal. A retained root waits only for its own epoch. A new observation waits for its base epoch and any new table used by its settlement descendants. An unrelated future proposal does not delay packet or handshake proofs or checkpoint refresh. Generation checks, host continuity and connection delays still apply.

Hermes expands the exact saved checkpoint through pinned snapshot queries. It stages the alternative history and submits two verified receipt references as misbehaviour. It never uses the latest history in place of the proposal's original checkpoint. Different temporary tails or an unsigned table disagreement alone cannot freeze the client. Sessions have no signer owner. Any signer can relay authentic progress, but a live session cannot be discarded. Permissionless cleanup is allowed after its fixed expiry.

An independent observer still needs qualifying native evidence and transaction inclusion within the supported window. The delay does not authenticate the stake allocation. Censorship, missing evidence or a false allocation may prevent progress. See [the verification design](probabilistic-bounded-verification.md) for the workload calculation and authorized recovery limitation.

## Mithril-Certified Stake

The epoch nonce comes from verified block history, and pool identities and VRF
keys come from the registration registry. Stake amounts are the remaining
unsigned part of an epoch table. Every client starts from a stake table that
Mithril certified. Afterwards a Cardano stake distribution certified by Mithril
outranks an uploaded stake table. Once one is recorded for an epoch, that
epoch's table must equal it and needs no response window. Until then the
uploaded table and its 12-hour response window apply. Every existing check
stays in place.

The anchor is three client-state fields, trusted at bootstrap like the
checkpoint: `mithril_epoch`, `mithril_aggregate_verification_key` and
`mithril_protocol_parameters_hash`. They name the aggregate verification key
that signs Mithril certificates in that epoch and the hash of its protocol
parameters. Every client must be created with them.

A relayer submits `MithrilStakeCertificates` through `MsgUpdateClient`. It
carries Mithril aggregator certificates in JSON from consecutive epochs,
starting at `mithril_epoch`. For each certificate the client:

1. requires `current_epoch` to equal the anchor epoch and the certificate's
   aggregate verification key to equal the anchor's;
2. accepts the certificate's protocol parameters only if their hash equals the
   anchor's, because certificate metadata, including the quorum parameters, is
   not signed;
3. checks that `signed_message` is the hash of the protocol message, with parts
   in Mithril's enum order, and verifies the STM multi-signature over it;
4. requires the certificate to certify a Cardano stake distribution, so the
   anchor cannot pass an epoch without recording its stake;
5. records the certified Merkle root for the epoch that distribution elects, and
   moves the anchor to the next epoch's signed verification key and parameters.

The multi-signature is verified as mithril-stm 0.12.0 verifies it. That is the
version the Mithril mainnet aggregator 0.9.22 (`3f6cb73`) builds with.

- **Lottery.** An index wins if `ev / 2^512 < 1 - (1 - phi_f)^(stake / total)`.
  `ev` is the BLAKE2b-512 hash of `map`, the commitment-prefixed message, the
  little-endian index and the signature, read as a little-endian integer. As in
  mithril-stm's default backend, the client compares `2^512 / (2^512 - ev)`
  with `exp(-w ln(1 - phi_f))` by an exact Taylor expansion with an early stop,
  and `phi_f` within `f64::EPSILON` of 1 always wins. The logarithm is
  correctly rounded with exact arithmetic, so every processor reaches the same
  result.
- **Indices.** Every claimed index must win and be at most `m`. Indices must be
  unique, and at least `k` are needed.
- **`phi_f`.** Mithril authenticates `phi_f` only through its U8F24 encoding in
  the parameters hash, while the lottery uses the exact float. The client
  requires the canonical value of the encoding: the binary64 nearest the
  decimal with the fewest digits that encodes to it. A configured `phi_f` with
  at most seven digits after the point always qualifies, and the lottery input
  is then a function of authenticated data.
- **Decoding.** Aggregate keys and signatures are decoded strictly:
  - integers go into typed fields;
  - byte strings must be JSON arrays of their exact length;
  - unknown fields, duplicate keys and trailing data are rejected;
  - signatures must be G1 subgroup points other than infinity.

`tests/mithril-reference` regenerates reference vectors from the pinned
mithril-stm and fixed crates. The tests check:
- every lottery outcome of upstream-signed certificates, including stakes above
  `2^63`;
- upstream aggregates, and their rejection once an index that did not win is
  claimed;
- U8F24 conversions at and around half points.

Fuzz targets cover certificate and multi-signature decoding and verification.

Mithril certifies the distribution of epoch `N`, the snapshot taken at its end,
during epoch `N+1`. That distribution elects the slot leaders of epoch `N+2`.
On mainnet the certificate appears minutes into epoch `N+1`, about five days
before it is needed, so relayers record it well before the rollover. Mithril's
distribution holds every pool with nonzero stake in that snapshot, which is the
table the client accepts.

An observation session uploads a new epoch's stake rows in Mithril's pool ID
order, the order of the canonical bech32 identifiers. As it seals the table,
the client builds Mithril's Merkle root from the pool IDs and lovelace stakes,
keeping only the mountain range's peaks. The receipt and the activated epoch
table record that root. A table that differs from a root Mithril has already
certified for its epoch does not seal, so no receipt can rely on it. When a
session first activates a new epoch's table:

- If a certified root is recorded for that epoch, the table's root must equal
  it. The table is then authenticated, so its deadline is the activation time
  and it becomes usable after the next committed host block. The host
  resumption guard still applies.
- Otherwise the table gets the usual 12-hour response window, and the client
  records the table's Mithril root as accepted for that epoch.

A certificate can arrive after a table was activated under the response window,
for example when a relayer catches up on several epochs of certificates. It is
checked against the accepted root rather than the activated table, which
retention cleanup deletes. If its distribution differs, the table is proven
wrong: `CheckForMisbehaviour` reports the certificates and the keeper freezes
the client. If it agrees, the certified root supersedes the accepted one, and
the window stays, because installed proof deadlines are immutable within a
generation. An accepted root lives until a certificate for its epoch is applied,
or with its generation if Mithril never certifies that epoch, at one small
record per epoch.

Mithril's authority also bounds misbehaviour evidence. A receipt whose table
differs from a root Mithril has certified for its epoch cannot serve as
evidence, whenever the certificate arrived, so an alternative history built on
a disproved table cannot freeze a client whose installed table Mithril
certified. If instead the client's own installed table is the disproved one,
the certificate itself freezes the client.

Certificates cost 2,000,000 gas each. A message carries up to eight, of at most
512 KiB each and 880,000 bytes together, the transport budget of an observation
step. Verifying a mainnet certificate takes about 40 ms, mostly in the exact
lottery comparison for each claimed index.
The client verifies them again in `UpdateState` because ibc-go's ReCheckTx path
omits `VerifyClientMessage`.

A client never starts from a stake table that only the response window
protects. A client bootstrapped in epoch `C` is created with the anchor for
epoch `C-1`. The final step of its bootstrap carries the certificate signed in
`C-1` that certifies epoch `C-2`'s distribution, which elects epoch `C`'s
leaders. Before the bootstrap completes, the client verifies that certificate
against the anchor, computes Mithril's Merkle root over the imported stake
table and requires the two roots to be equal. It then records the root for
epoch `C`, moves the anchor to epoch `C`, and makes the table usable after the
next committed host block. Until the bootstrap completes the client accepts no
`MithrilStakeCertificates`. With the largest supported table, 4,000 pools, the
final step uses about 5.9 million gas, within the 36 million gas bound of an
operation. A genesis builder using `InitializeFromTrustedCheckpoint` must supply
the same certificate.

The bootstrap tool therefore requires an aggregator, for example
`go run ./cmd/bootstrap -input trusted-checkpoint.json -output bootstrap.json
-mithril-aggregator https://aggregator.release-mainnet.api.mithril.network/aggregator`.
The certificate that sealed epoch `C-3`'s distribution, signed in `C-2`, names
the key and parameters that sign epoch `C-1`'s certificates, and gives the
anchor. The tool fetches the certificate that sealed epoch `C-2`'s distribution
and checks it against the trusted table before writing the bundle, so a
bootstrap needs an epoch of at least 3. The public aggregators are
`release-mainnet`, `release-preprod` and `pre-release-preview` at
`https://aggregator.<name>.api.mithril.network/aggregator`.

Caribic's local network runs its own aggregator and two signers, one for each
of two of its five producers. The aggregator certifies Cardano stake
distributions with `k = 5`, `m = 100` and `phi_f = 0.65`. As in Mithril's own
tests, the aggregator and signers start in epoch 1, since in epoch 0 there is
no earlier epoch to read signers from. The aggregator creates the genesis
certificate in epoch 2 from the signers registered in epoch 1, and they sign
from epoch 3. A client
bootstrapped in epoch C needs the certified distributions of epochs C-3 and
C-2, so a new local network's first client waits for epoch 5. With 5,000-slot
epochs that would be about seven hours. Instead, `caribic start network`
steps a new network's clock forward 300 seconds at a time, as the migration
rehearsal does, and every producer must reach each step on the indexed
history. Mithril follows epochs on the chain, so it isn't affected. Each
epoch is left only once the nonce service has observed it and Mithril has
done its work there: signer registrations, the genesis certificate, and the
previous epoch's stake certificate. Startup returns in epoch 5, once Mithril
has certified the distributions of epochs 2 and 3. From then on the clock
runs at normal speed and the network keeps its usual parameters. Public
networks run no Mithril containers.

The Gateway's `MithrilStakeCertificates` query returns up to four certificates
that extend a given `mithril_epoch`, ready to submit as a client message.
Hermes asks for them from each client's refresh task and before it
stages a new epoch table, and submits any it receives. After an empty answer it
waits ten minutes before asking again for the same epoch. The Gateway also
refuses to propose a stake table that differs from a distribution Mithril has
certified for its epoch, because the client would reject or freeze on it.

Recovery adopts the substitute's Mithril state.
- **What carries over.** The substitute's anchor, the roots it certified for
  epochs after its checkpoint, and its accepted roots for epochs after its
  anchor up to its checkpoint are pinned when the authority approves the
  recovery. Activation installs them in the new verification generation. The
  replacement's next rollovers need the certified roots, and its history relies
  on the accepted tables, which late certificates must still be able to disprove.
- **What stays behind.** Certified roots are kept per generation. The subject's
  roots stay with its old generation and are not trusted afterwards. A relayer
  re-establishes any beyond the substitute's anchor by submitting those
  certificates again.
- **When recovery is refused:**
  - subject and substitute certified different distributions for one epoch;
  - they hold different anchors for one epoch;
  - the substitute's anchor is more than eight epochs ahead of its checkpoint,
    or more than 64 epochs behind it.
- **Trust configuration.** Every client is created anchored. Recovery still
  refuses a subject or substitute without an anchor, so it cannot remove
  Mithril-certified stake.

The verifier links blst through cgo, so chain binaries must be built with
`CGO_ENABLED=1`. On amd64, blst's Go binding uses ADX instructions unless it is
built portable. Build distributed binaries with
`CGO_CFLAGS="-O2 -D__BLST_PORTABLE__"`, which picks the instructions at run
time, as mithril-stm's own blst build does. CI runs the verifier tests on amd64
in both builds, on arm64 Linux and on macOS.

This adds Mithril's assumptions: the genesis key behind the anchor and an
honest majority of the stake that signs Mithril certificates. A client cannot
be created until Mithril certifies the distribution that elects its bootstrap
epoch's leaders. If Mithril later never certifies some epoch's distribution,
the anchor cannot advance past that epoch. The client keeps working, and every
later epoch falls back to the response window.

## Host-Chain Software Upgrades

A Cosmos binary replacement runs the selected verifier against existing
`08-cardano-probabilistic-N` stores. A compatible update preserves the client,
connection and channel IDs; it requires neither a new Cardano `CreateClient`
nor an Aiken redeployment or replacement voucher denomination. Creating a new
client does not retarget an existing connection.

Software upgrades require stable type URLs, safe historical-state decoding,
compatible private store keys and defined verifier activation. Test the exact
old and new artifacts and apply any required host app migration before normal
operation.
The supported client format and authenticated snapshot objects must survive any compatible host replacement. Migration from the removed inline format is not implemented by this client. Standard IBC `MsgUpgradeClient` is deliberately unsupported because this client defines no authenticated on-chain commitment authorizing state replacement.

## Substitute-Client Recovery

An expired or frozen probabilistic client can be recovered from a compatible,
active substitute through the ibc-go authority and governance path. Recovery
updates the original subject client ID; it does not point the connection at the
substitute. Existing connection and channel identifiers, packet state, ICS-20
escrow, and voucher denominations therefore remain unchanged.

The concrete protobuf client type must match. The subject and substitute must
also have the same upgrade path, HostState NFT policy ID and token name, Cardano
system start, slot length, slots per KES period, maximum KES evolutions,
active-slot coefficient, maximum clock drift, and epoch schedule. The
substitute checkpoint must be strictly newer, its latest consensus and delay
metadata must be present, and its operational-certificate counters may not
regress. Recovery cannot be used to cross client types or move a route to a
different HostState NFT deployment.

Recovery pins the substitute's verified checkpoint. Bounded continuations reject certificate-counter rollback before activation advances the subject's generation. Old proof roots and sessions become unusable immediately. The replacement adopts already usable state and requires a completed block after its recovery cutoff. It starts no new stake challenge. Collection cleanup runs separately through bounded maintenance.

See the [probabilistic-client recovery runbook](./probabilistic-client-recovery.md)
for the local v8/v10 Classic test, its membership and non-membership assertions,
and the Injective-oriented operating procedure. Recovery is valid after genuine
expiry or a freeze caused by independently verified cryptographic
misbehaviour. Misbehaviour must never be fabricated simply to make an active
client recoverable.

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

The HostState datum decoding and ICS-23 proof verification were carried over from the Mithril client. The proof model is the same; only the trust anchor that authenticates the root changed.

## Finality Parameters

The current finality parameters are embedded in the light-client module:

- `threshold_depth = 24`
- `threshold_unique_pools = 5`
- `threshold_unique_stake_bps = 511`
- `depth_weight_bps = 2000`
- `pools_weight_bps = 2000`
- `stake_weight_bps = 6000`

They are not supplied by the Gateway and are not serialized into `ClientState`.


### Permissionless HostState heartbeats

Rootless checkpoints can keep an idle client active without a Cardano heartbeat transaction. Heartbeats provide fresh root-bearing proof heights. Any funded payment-key signer can submit a root-preserving HostState heartbeat without the deployment authority. Gateway schedules it after six hours without an ordinary HostState transaction. Hermes follows the returned check delay and retries failed submissions using `host_state_heartbeat_interval`.

The contract keeps `last_heartbeat_time` in the Cardano-owned control datum. A heartbeat sets it to the finite validity upper bound and requires the next heartbeat's lower bound to be at least six hours later. Its validity window may be at most two minutes. Ordinary operations preserve this clock. The IBC root, sequence counters, authority, lifecycle state and HostState value remain protected. Heartbeats remain disabled during shutdown and by the existing heartbeat restriction bit.

Bootstrap and Hermes require a trusting period that leaves time for bounded maintenance and the response window. Use at least 48 hours for the maintained profiles. The six-hour cadence leaves time for Cardano confirmation and destination client updates. Operators must still relay those updates before expiry. Clients created outside Gateway need a compatible trusting period too.

This changes the Cardano HostState control schema to wire version 5 and requires the matching validators and builders. Existing deployed scripts retain their old behavior. Existing deployments need a fresh deployment or a schema-aware upgrade before using these heartbeats. Historical five-field control datums remain readable by Gateway. Counterparty light clients treat the control field opaquely, so their HostState root decoding does not change.
