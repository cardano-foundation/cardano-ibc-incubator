# Compatible implementation replacement

Implementation work for #462 starts from `fde2635138f60f6d14954b2f91e4a001b74c12a2` on `feat/462-state-preserving-redeployment`. The unrelated `feat/host-state-full-key-trie` worktree is not part of this change.

The implementation was subsequently rebased onto main at `30aa394aa4616f4327a6a34bbbaea1e0eb58ecf5`. The pushed archive branch `archive/462-pre-rebase-018532b51` retains the original history and the source commits referenced by earlier rehearsal evidence.

This document specifies the implementation boundary. Validation results are recorded separately; a requirement here is not evidence that it has passed.

## Compatibility and authority

Existing immutable deployments retain their original scripts and permitted transitions. They have no demonstrated state-preserving migration path. The feature applies only to a fresh migration-capable baseline and its successors. Legacy evidence must use the unmodified source commit/blueprint.

The replaceable roles are HostState, staged Tendermint client, connection, channel, and transfer application/escrow. HostState NFT, client/connection/channel policies, port and module capabilities, voucher policy and asset names, escrow shard policy, routes, and packet/data codecs remain fixed. The original applied policy bytes are retained, not reconstructed using a newer compiler or blueprint. Metadata, trace registry, session verification/minting, proof verification, and recovery/history support remain fixed dependencies; changing them is unsupported in this compatibility profile.

An immutable migration registry, authenticated by a one-shot NFT, governs the exact full Cardano addresses and generation of all replaceable roles. Configuration supplies an explicit threshold and distinct governance key hashes. There are no default production authorities. Approval signs the complete source-bound plan, successor role map, compatibility/fixed-dependency digest, nonce, and activation window. On-chain time anchors the minimum activation delay. Governance can cancel before migration begins and can rotate through the same delayed authorization process. Executors do not require governance keys after approval.

Governance can approve malicious replacement logic capable of later stealing funds. Exact conservation during migration does not eliminate that trust. The immutable migration mechanism and retained policies are also trust and availability boundaries; bugs in them are not universally recoverable.

## Production dependency boundary

The original deployment planner applies spending hashes into policies and dependent validators. Republishing reference scripts cannot alter those applied bytes or the credentials controlling existing outputs. This baseline changes that authorization graph at deployment time; it does not add an entry point to already deployed scripts. Legacy shutdown is a terminal cleanup path, not a demonstrated populated handover.

| Component | Authentication and replacement boundary | Production paths |
| --- | --- | --- |
| Deployment identity and HostState | Original HostState NFT authenticates state and counterparty roots. Its policy remains fixed; approved HostState custody may change. | `validators/host_state_stt.ak`, `validators/upgradeable/host_state.ak`, `lib/ibc/implementation` |
| Replacement authority | One-shot registry NFT authenticates the immutable kernel; exact role addresses, generation, fixed dependencies and proposal nonce bind approval. | `validators/minting_implementation_registry.ak`, `validators/implementation_registry.ak`, `lib/ibc/migration` |
| Clients, connections and channels | Original policy/name derivation and HostState counters authenticate each object. Normal dispatch resolves the active approved credential; migration moves the same NFT and datum. | `validators/minting_{client,connection,channel}_stt.ak`, `validators/upgradeable/{client,connection,channel}.ak` |
| Port and application authority | Original port/module capabilities remain fixed. Activation verifies the single permitted transfer registration and committed-leaf change. | `validators/minting_port.ak`, `lib/ibc/core/ics-025-handler-interface/ibc_state_commitment.ak`, migration kernel |
| Transfer root and escrow | Existing application token and shard NFTs authenticate custody; the retained shard registry root proves completeness independently of address scans. The transfer spender is replaceable. | `validators/upgradeable/transfer.ak`, `validators/spending_transfer_module.ak`, `lib/ibc/migration` |
| Vouchers and refunds | Original voucher policy/name, channel trace, mint/burn and refund/remint authorization remain applicable. Registry-authenticated active spenders replace the former fixed spending-credential dependency. | `validators/minting_voucher.ak`, `validators/spending_channel.ak`, channel operation validators |
| Fixed proof and supporting resources | Packet operation scripts, proof verification, staged session resources, trace registry and metadata retain their original applied bytes and identities. No cleanup is permitted while this profile is live. | `migration-plan.ts` compatibility inventory; retained validators and upgradeable shutdown guards |
| Artifact construction and submission | The complete role/dependency map is deterministically applied and checked; canonical registry state controls execution and manifest installation. | `cardano/offchain/src/{deployment-plan,migration,migration-transactions,migration-manifest}.ts`, migration CLI |
| Indexing and transaction construction | Gateway and SDK resolve the current registry, authenticate historical address lineage, preserve historical datums/proof roots and reject unsupported manifests or mixed-version operations. | `packages/cardano-ibc-tx-builder-runtime/src/migrationRuntime.ts`, Gateway manifest/history/proof-context services |
| Relayer and remote verification | Hermes pins the bridge manifest and retains the requested packet proof height. The supported Go client authenticates the unchanged HostState NFT and commitment codec, not channel-name reuse. | `relayer/crates/relayer/src/chain/cardano`, `cosmos/cardano-probabilistic-light-client-core`, Gateway historical proof services |

Validator paths in this table are relative to `cardano/onchain`; off-chain filenames without a prefix are relative to `cardano/offchain/src`. The fixed compatibility inventory includes actual script bytes, schema/profile identifiers and deployment inputs. A changed policy, proof codec or unsupported counterparty fails closed rather than creating a replacement asset or route.

## State transitions

| Phase | Normal bridge operations | Governance and migration |
| --- | --- | --- |
| Active | Existing packet/client/application rules apply | Propose complete successor or authority rotation |
| Approved, before begin | Existing-object settlement/client updates continue; new core objects and escrow shards are frozen | Delayed begin, or authorized cancellation |
| Migrating | No HostState-root-changing operations; neither generation can service packets | Permissionless bounded continuation from canonical registry state |
| Active successor | Existing identities service old and new traffic | The same mechanism permits the next migration |

Begin atomically consumes registry and HostState, freezes the current counters/root and authenticated transfer escrow inventory, and moves the real HostState NFT to its approved successor. No normal operation or protocol mint/burn may be combined with this transition. Begin is the irreversible boundary; cancellation afterward is not offered. Session verification/cancellation may continue under unchanged session rules, but final client updates wait for activation.

Each subsequent transaction moves one authenticated core object, transfer root, or escrow shard plus the registry. It preserves the exact inline datum, reference script, all non-ADA assets, and at least the original ADA. Separate wallet inputs fund fees and any minimum-ADA increase. Exact full successor addresses are approved; an operator cannot supply a replacement stake credential. Distinct tokens and one-object transactions prevent double satisfaction. No protocol tokens are minted or burned during migration.

For this baseline, ordinary retirement and terminal shutdown are disabled. This preserves the invariant that every sequential core token below the captured next-client/connection/channel counters exists. Migration processes each exact derived token at its next cursor. Future support for active retirement requires authenticated tombstones or a live inventory and is outside this feature.

The transfer root's authenticated escrow registry supplies the complete shard inventory. Migration deletes a leaf from a separate remaining-inventory root only when that real shard is moved. The application registry itself is preserved. Address scans aid discovery but cannot authorize omission. Retained fixed resources are explicitly identified and are not claimed to have moved.

Activation requires all sequential cursors complete, the transfer root moved, and the remaining escrow inventory empty. It updates the transfer port's registered implementation and verifies the corresponding `ports/transfer` commitment change against its old value. Other committed state, sequences, receipts, acknowledgements, escrow balances, and pending refunds remain unchanged. No operator-supplied replacement root is accepted.

## Interruption and operational behavior

Prepare and inspect are read-only/deterministic. Authorization, begin, each move, and activation are distinct transactions. Resume reconstructs progress from the canonical registry, source tokens, and authenticated inventory; local submission logs are advisory. Rejected/stale transactions are rebuilt. Rollbacks invalidate optimistic progress. Active artifact selection verifies role addresses, generations, fixed script/policy hashes, and the on-chain registry. A stale or incompatible manifest fails closed.

The migration pause does not pause Cosmos. Counterparty packets can queue or time out while Cardano is paused. Historical proofs, client trust windows, refund/remint obligations, and post-activation client recovery remain relevant. Completion is permissionless, but depends on chain availability, published scripts, and live or recoverable clients. The mechanism preserves claims through interruption; it cannot promise bounded wall-clock recovery from arbitrary external failures.

The supported operational counterparty for this feature is the repository’s ibc-go v8 classic ICS-20 chain with its stake-weighted probabilistic Cardano client. Gateway startup rejects migration-enabled deployments configured for Mithril, including historical-only mode, until exact historical certification across migration is implemented and demonstrated. This is a software support boundary; it does not prevent an external chain from independently installing a different client. No existing non-migration Mithril support is removed.

The supported probabilistic client requires adjacent epoch transitions with accepted stability evidence in each epoch. An epoch without enough descendants or qualified pool participation can leave an existing client unable to catch up; migration cannot repair that immutable counterparty limitation. Verify counterparty catch-up before Begin and preserve its trust window throughout interruption. Sparse synthetic clock advances are unsuitable evidence unless they retain those checkpoints.

Go counterparties identify HostState by its unchanged NFT and decode the unchanged datum/commitment codec. No generic channel-upgrade capability is assumed. Gateway history recovery must authenticate address lineage and replay original creation plus migration continuations; changing only the current manifest address is insufficient.

## Required evidence

The release requires compiled-validator transaction tests, independent model/state-machine tests and guard-removal controls, transaction budget measurements, cold-history/rollback recovery, and a populated local Cardano/Cosmos rehearsal of V1 to V2 to V3. It must exercise both asset directions, original vouchers, multiple objects/channels, pending receive/ack/timeout/refund/remint, interruption, new traffic and creation after activation, and rejected premature cleanup. Never use live authority keys or real user funds.
