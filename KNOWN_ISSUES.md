# Architectural Challenges

Author: Julius Tranquilli, https://github.com/jtranq

This document tracks engineering challenges caused by asymmetries between Cardano and Cosmos, including differences in transaction semantics and consensus algorithms. **It was reviewed on July 10, 2026.** The maintained Cardano client is the experimental `08-cardano-probabilistic` client. The older Mithril client is deprecated, disabled, and retained only as historical design reference and for type compatibility.

## Introduction

Ouroboros and Tendermint differ in how blocks are produced and in the evidence a light client can verify. When bridging Cardano and Cosmos, we need to understand both who produced a block and what evidence makes its state acceptable to the other chain.

Tendermint produces a header at each height and a commit containing signatures from more than two-thirds of the validator voting power. Validators exchange prevotes and precommits for a block ID before committing that block. The header includes an `app_hash` supplied by the application. In a conventional Cosmos SDK chain this commits to the application stores and supports ICS-23 membership and non-membership proofs. It reflects the state after executing the **previous** block. A packet commitment created in block `100` is therefore reflected in header `101`. The initial header uses the state returned at chain initialization. See the [CometBFT header specification](https://github.com/cometbft/cometbft/blob/main/spec/core/data_structures.md#header).

Under Ouroboros Praos, each slot is an opportunity to produce a block. Each stake pool privately checks a verifiable random function (VRF) against a threshold determined by its relative delegated stake in the epoch-frozen Praos snapshot. A slot can have no eligible pool, one eligible pool, or several. The VRF proof allows other nodes to check eligibility for that slot. See the [Praos glossary](https://ouroboros-consensus.cardano.intersectmbo.org/docs/references/glossary/).

The pool signs its block header with a key-evolving signature (KES) key. After the key evolves and the old signing material is erased, compromising the current key does not allow an attacker to forge signatures for earlier KES periods. For example, a key compromised in period `10` cannot be used to sign a block from period `9`. See the [Cardano key documentation](https://docs.cardano.org/about-cardano/learn/cardano-keys).

These checks authenticate the producer and its slot eligibility under the supplied epoch context. They do not establish that all transactions in the block satisfy the ledger rules. A full node also validates the block body and applies those rules. Neither check supplies a per-height quorum commit from SPOs.

To be clear about why that's such a big deal, the crux is that "verifiable" and "trustworthy as an IBC root" are totally different things. When we talk about a Tendermint header being trustworthy we're bundling three different concepts together:

**#1. Authenticity: who produced it / did the network agree ?**

**#2. Finality / Canonicity: is this THE header for height H ?**

**#3. State commitment: does it contain an authenticated root I can verify proofs against ?**

For **#1** and **#2**, a Tendermint commit proves that more than two-thirds of the voting power in a validator set signed the block. A light client must first establish that this is the chain's validator set. It starts from a trusted checkpoint and verifies validator-set changes while the trusted state remains within its trusting period. Tendermint's safety guarantee assumes less than one-third Byzantine voting power. A header and a list of signing keys supplied by an unknown party cannot establish that trust on their own. See the [CometBFT light-client verification specification](https://github.com/cometbft/cometbft/blob/v0.38.x/spec/light-client/verification/README.md).

For **#3**, the conventional Cosmos SDK `app_hash` commits to a multistore that combines the module store roots. Individual module stores use IAVL trees, so `app_hash` is not simply one module's IAVL root. This commitment appears in the next block's header. Tendermint itself does not require a particular application storage format. See the [Cosmos SDK storage model](https://docs.cosmos.network/sdk/latest/learn/concepts/store).

On the Cardano side we'll start with **#1** which is the authenticity problem. Cardano does not produce a per-height quorum certificate, so a Cardano IBC client needs additional assumptions or machinery to approximate the guarantees that IBC normally gets from Tendermint consensus.

An authenticated Cardano header gives evidence about its producer. It does not show that a supermajority of SPOs has voted to finalize that block. Praos instead provides probabilistic settlement under its stake and network assumptions, so the bridge needs evidence beyond a single leader's header.

The maintained probabilistic client does not derive a Tendermint-equivalent quorum condition. It applies configured depth, pool-diversity, and stake-weight thresholds to a contiguous Cardano block-history witness. This provides deterministic acceptance rules, but not a portable finality certificate. Canonical history and epoch context currently come from configured observer data, so the model has explicit data-source and honest-observer assumptions.

The deprecated Mithril client explored a different tradeoff: it used stake-based certificates and transaction-snapshot proofs as a portable trust anchor, but checkpoint cadence and tip lag made it unsuitable for the latency expected from the maintained bridge path. Historical Mithril design and operating assumptions are documented in `docs/mithril-light-client.md`.

Next **#2**, also significant problems arise here because even the **notion** of canonicity doesn't exist on the same paradigm. On Cardano canonicity is basically a **chain-level** property as opposed to a block/header-level property. In Ouroboros you can see multiple short-lived forks where multiple competing blocks are valid. That's why in the Cardano developer community you'll often hear this "k-deep/k-blocks" logic, as in "if you wait k blocks, you can consider the block to be **reasonably** final" (In fairness this is true, and a fine paradigm for dApp development). But that means that a header that you fetch "right now" is not inherently a final checkpoint the way that a Tendermint header+commit is.

Finally **#3** (state commitment), current Cardano headers do not contain a ledger-state root that an ICS-23 verifier can use directly. They do [commit to the block body](https://ouroboros-consensus.cardano.intersectmbo.org/docs/references/block_diagrams_of_data/), so a verifier can authenticate transaction data and extract an application commitment such as our HostState root. Additionally of relevance here is that in a general blockchain sense, Cardano's contracts are stateless, and there is no KV-store, so the chain state lives in the UTxO set. Consequently, the ledeger state is something you derive by applying transactions under the ledger rules, not something the protocol exports as a compact commitment under each header. To be clear on what I mean by that, "the state of the chain" is not something that consensus publishes as a small cryptographically-comitted value in block headers. In reality, every node computes the ledger state by taking the block's transactions and applying them to a local state under the ledger's rules.

State commitments and settlement are separate properties. Two competing forks can each contain a correct root for their own state. A root lets us check what state a block commits to, but does not by itself tell us which block will remain on the canonical chain. Probabilistic settlement does not make a state commitment impossible. For example, [Ethereum block headers](https://ethereum.org/developers/docs/blocks/) contain state roots before those blocks are finalized.

The STT architecture addresses the application-state commitment problem, but it does not remove the consensus asymmetry. It makes `ibc_state_root` a script-enforced commitment to Cardano IBC state; a counterparty still needs a defensible way to decide which Cardano transaction and HostState output are canonical. The current probabilistic client supplies a configurable settlement heuristic for that decision, not parity with Tendermint finality.

There are also some open questions about ramifications of the Ouroboros Peras upgrade, which at the time of writing are described as:

""... after a failed voting round, Peras enters a cooldown period during which voting is suspended and the protocol essentially proceeds as Praos. The length of the cooldown period must be sufficiently long to ensure that any adversarial advantage gained from an unfavorable distribution of votes in the failed round will be neutralized by the end of cooldown. There is a tradeoff between the boost provided by votes and the length of the cooldown period. The higher the boost, the higher the potential damage caused by an unsuccessful voting round, and thus, the longer before voting may be resumed..."

The implications for Cardano IBC remain to be quantified. Faster native settlement could permit stronger or lower-latency probabilistic acceptance parameters, but those parameters must be studied and updated explicitly.


# Asymmetries and Architectural Considerations

## Unimplemented / Not Supported

The following IBC features are not currently supported by the Cardano bridge path.

### Channel Upgrades

Existing channels should be treated as fixed once established. If channel parameters need to change, the practical path is to open a new channel and migrate application routing to that new channel rather than attempting an in-place channel upgrade handshake.

`ibc-go` v8.1.0 introduced channel upgradability. Compatible applications could change the channel version, ordering, or connection without replacing the channel. Upstream v10 later removed channel upgradability and ICS-29 fee middleware. Support on a Cosmos counterparty therefore depends on its version and application stack. See the [v8.1 migration guide](https://github.com/cosmos/ibc-go/blob/main/docs/docs/05-migrations/12-v8-to-v8_1.md) and [v10 changelog](https://github.com/cosmos/ibc-go/blob/v10.2.0/CHANGELOG.md).

Cardano IBC now provides a narrower, Cardano-local cleanup operation for packet
history without implementing the channel-upgrade handshake. After the source
packet commitment has been removed by acknowledgement or timeout, anyone may
submit its authenticated non-membership proof. The operation deletes the
matching Cardano receipt and acknowledgement on an unordered channel, or only
the acknowledgement on an ordered channel, whose monotonic receive sequence
remains the replay guard. The channel also records a monotonic proof-height
floor and receive high-water mark on-chain, so deleting those entries does not
make an older packet-membership proof replayable; unresolved packets remain
deliberately unprunable.

Ordered-history pruning changes the Channel and HostState validator hashes and
therefore requires a fresh bridge deployment and new channels. Existing
Channel and HostState UTxOs cannot be migrated to the new validator addresses
in place.

Adding channel upgrades here would require a compatible counterparty implementation. A newer `ibc-go` version does not by itself imply support for that handshake.

### ICS-29 Fee Middleware

The Cardano relayer endpoint cannot query incentivized packets and its counterparty payee registration method does not register a payee. It therefore does not provide a Cardano-side ICS-29 fee interface.

ICS-29 is also [deprecated in the IBC standards index](https://github.com/cosmos/ibc/blob/main/README.md#app-1), and `ibc-go` v10 removed its fee middleware. For routes to older Cosmos counterparties, relayer compensation must be assessed against that chain's fee configuration and the channel's negotiated capabilities.

### Host Consensus State Query

Cardano host consensus state queries are not implemented. The relayer endpoint cannot currently answer the standard host consensus state query for Cardano in the way it can for a conventional Cosmos SDK chain. This is a consequence of the same underlying asymmetry discussed elsewhere. Cardano does not expose Tendermint-style per-height consensus states with an `app_hash`. The bridge instead authenticates Cardano IBC state through the Cardano HostState commitment and the relevant Cardano light-client evidence. Any workflow requiring a generic host consensus state query should be treated as unsupported for Cardano today.

This is not currently a target for further development.

### Balance Query

Balance queries through the Hermes Cardano chain endpoint are not implemented. This does not mean Cardano balances are unknowable, since balances can still be inspected through Cardano-specific tooling, Gateway functionality, or local test tooling where available. The unsupported part is the generic relayer balance query interface for Cardano.

As a practical example, commands such as relayer wallet balance checks should not be expected to work uniformly for Cardano the way they do for Cosmos SDK chains. Operational scripts should use Cardano-specific balance inspection paths instead.

### ICS-31 Cross-Chain Queries

ICS-31 cross-chain queries are a work in progress for Cardano, but will need to be implemented on a per-chain basis. Much of the basic infrastructure exists for cross-chain queries with Cheqd, but still must be tested and validated against each supported counterparty chain.

### Client Upgrade

Standard IBC client upgrade is not currently supported for the Cardano light client. The probabilistic Cardano light clients reject `VerifyUpgradeAndUpdateState`.

Operational-certificate validation adds information that must be present when a client is created: the certificate number currently in use by each Cardano stake pool and the network limit on a block-signing key's lifetime. Cardano IBC is not live today, so there are no deployed clients or routes to migrate for this change. The first deployment must create every client with this information from its initial Cardano checkpoint. Before allowing the Gateway to create those clients, deploy the upgraded Cosmos light-client code and use Ogmios v6.12.0 or newer.

This may be a target for further development.

## Denom Display in Wallets

A Cardano `assetName` can contain at most 32 bytes. The bridge's voucher token name uses a four-byte CIP-67 label for fungible tokens (`333`) followed by a 28-byte Blake2b hash of the full denom trace. The [packet decoder](cardano/onchain/lib/ibc/apps/transfer/types/fungible_token_packet_data.ak) and [trace registry](cardano/onchain/lib/ibc/apps/transfer/trace_registry.ak) each limit denomination strings to 256 bytes. A supported trace can therefore still be too long to use directly as an asset name. See the [voucher naming implementation](packages/cardano-ibc-trace-registry/src/voucher.ts).

The first mint of a voucher also creates a [CIP-68](https://cips.cardano.org/cip/cip-68) reference NFT with label `100` under the same policy. Its immutable datum records the full denom trace and the voucher identity. The on-chain policy requires this metadata to match the voucher being minted. Later mints reference the existing metadata rather than creating it again. See the [minting policy](cardano/onchain/validators/minting_voucher.ak).

For `transfer/channel-7/uosmo`, the generated `name` and `ticker` are `uosmo`. These labels come from the last segment of the base denom. They do not establish an official token brand or display precision. The [metadata builder](cardano/onchain/lib/ibc/apps/transfer/voucher_metadata.ak) does not currently supply a `decimals` value.

This removes the need to submit CIP-26 registry entries for every voucher or to pre-register possible routes. Wallets that resolve the CIP-68 metadata can use it for presentation. Other wallets may still show raw asset identifiers or require a registry entry or another metadata integration. Creating metadata on-chain does not guarantee that every wallet will display it.

The full trace remains part of the asset's identity. For example, `transfer/channel-7/uosmo` and `transfer/channel-8/uosmo` produce different voucher token names even though both display labels are `uosmo`. If a redeployment changes the voucher `policyId`, its vouchers are also different Cardano assets. Wallet integrations must resolve the new asset identities rather than assume that matching labels make them interchangeable.

## Underlying Cryptography

There are two different membership and non-membership problems in IBC, and the asymmetry between Tendermint and Cardano matters in different ways depending on which direction verification is happening.

When Cardano verifies Cosmos state, it follows the standard ICS-07 flow: Cardano stores a trusted consensus root for the Cosmos chain from signed Tendermint headers and verifies ICS-23 membership and non-membership proofs against that root.

When a Cosmos chain verifies Cardano state there is a fundamental asymmetry. In the Cosmos SDK model, an authenticated header at height `H` contains the application commitment after block `H-1`. ICS-23 proofs link the relevant module store to `app_hash`. Nodes and indexers supply proof material, which the verifier checks against that authenticated root.

Cardano does not expose anything analogous to a Tendermint per-height quorum commit that both identifies the canonical chain and attests to an application state root. Cardano block producers sign blocks, but Ouroboros does not provide the same per-height quorum commit that a Tendermint light client checks against an authenticated validator set. Chain selection and settlement depend on the ledger rules and consensus protocol. An external verifier needs additional evidence or trust assumptions to decide which Cardano history to accept.

This is why just querying a node is not a trustless replacement for a light client. If the Cosmos chain (or its relayer) simply asks a node, an indexer, or the Gateway “what is the current HostState UTxO and datum?” then the security model reduces to trusting that external party’s view of the chain. Even if the data is accurate most of the time, the verifier has no cryptographic basis to reject stale data, fork data, or fabricated data. In the Tendermint client model, the counterparty authenticates the header from its trusted checkpoint and checks the commit under the validator-set and trusting-period assumptions above. It can then check ICS-23 proofs against the authenticated `app_hash`.

In the Cardano IBC architecture in this repository, the on-chain datum on the HostState UTxO contains `ibc_state_root`, which is an application-level commitment to Cardano’s IBC key/value state. That commitment is made meaningful by script-level enforcement: every state transition that changes committed IBC state must co-spend the HostState UTxO (identified by the HostState NFT) and must update `ibc_state_root` consistently with the witness data present in the transaction, so the commitment root and the underlying state cannot diverge. This closes an “internal correctness” gap on Cardano (the operator cannot arbitrarily write a new root), but it still does not solve the “external attestation” problem. Effectively what we've done is skirted the fact that Cardano has no such analogous `app_hash` by inventing a local one that only covers the on-chain state of the IBC host infrastructure. Cosmos then uses the transaction output selected by the active Cardano client as the source of truth for Cardano-side IBC host state changes.

Separately, a counterparty must decide that a specific HostState update transaction, including the exact output datum bytes containing `ibc_state_root`, is included in an accepted view of the Cardano ledger. The maintained probabilistic client verifies a contiguous block witness from a previously trusted height, binds the HostState transaction/output to the accepted anchor block, and applies configured depth, pool-diversity, and stake-weight thresholds to descendant blocks. After accepting that anchor, the verifier extracts `ibc_state_root` and uses standard ICS-23 membership and non-membership proofs against it. This is a settlement heuristic over observer-supplied history, not a quorum-attested finality proof.

Height semantics must therefore be explicit. The proof height is the accepted Cardano anchor block number for the HostState root, not a Cardano slot number or necessarily the live chain tip. This asymmetry affects query semantics, proof heights, timeouts, and relayer waiting behaviour.

## UTXO Contention

TLDR: Root-changing IBC transactions are serialized through the canonical HostState UTxO. This is a throughput and liveness constraint independent of the selected Cardano light-client mode. Sharding or carefully constrained batching remains future work.

The IBC HostState design treats the HostState UTxO (identified by the HostState NFT) as the single source of truth for `ibc_state_root`; every IBC state transition that changes committed state must co-spend that same UTxO to update the root. This effectively serializes all root-changing IBC operations (client, connection, channel, and packet state updates), even if they touch disjoint keys. This enforces a unique, script-checked successor root but creates contention under load. This is not a correctness problem, but it is a throughput and liveness constraint that differs materially from Cosmos SDK chains where many updates can be committed independently in the same block.

We haven't settled on a production strategy to mitigate this. Options include batching multiple IBC updates into a single HostState-spending transaction, which I think is an uglier solution,  or alternatively sharding committed IBC state into multiple independently-spendable state UTxOs (and adjusting the commitment model and light client verification accordingly) so unrelated flows do not contend on a single global input. This will likely be a complex and challenging solution but I believe is the more "correct" path forward.

## Constrained by Probabilistic Settlement

On Cosmos SDK chains, state changes from block `H-1` can be proved against the `app_hash` in authenticated header `H` when the required historical state is available. In the maintained Cardano-to-Cosmos direction, a HostState update can be observed immediately but cannot be used until its anchor block satisfies the probabilistic client's configured acceptance thresholds and the required history and epoch context are available.

Cross-chain latency is therefore driven by block depth, distinct-pool and stake-weight thresholds, history availability, and relayer progress. The Gateway and relayer must consistently treat the accepted anchor block number as the proof height and wait for accepted-height progression rather than assuming the live tip is immediately usable.

## Stability Client Epoch Context Trust

The stake-weighted stability client relies on an epoch context containing stake weights, VRF key hashes, nonce, KES settings, and epoch slot bounds, but that context is not yet independently authenticated as the canonical Cardano epoch context. The current mitigation is fail-closed: once an epoch context is accepted for an epoch, a later header carrying a different context for that same epoch is treated as misbehaviour and freezes the client. This does not prevent the first relayer for an epoch from supplying a bad-but-internally-consistent context; it only makes a later contradictory context detectable. In practice, this means the trust model requires at least one honest relayer or observer to keep submitting the real epoch context so that a poisoned first context can trigger misbehaviour rather than remain silent.
