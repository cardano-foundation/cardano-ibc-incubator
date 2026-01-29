# Known Issues, Asymmetries, and Architectural Considerations


## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano’s UTxO model does not provide an equivalent general-purpose on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (for example in the Gateway’s database).

The mapping is fully reconstructible from on-chain data because voucher minting transactions contain the full fungible token packet data while simultaneously minting a voucher whose token name is derived from that denom. In practice, however, denom trace queries rely on off-chain indexing infrastructure rather than direct chain state queries, and we should continue to track this asymmetry and decide whether additional on-chain data or standardized rebuild tooling is needed for production readiness.

## Underlying Cryptography

There are two different membership and non-membership problems in IBC, and the asymmetry between Tendermint and Cardano matters in different ways depending on which direction verification is happening.

When Cardano verifies Cosmos state, it follows the standard ICS-07 flow: Cardano stores a trusted consensus root for the Cosmos chain from signed Tendermint headers and verifies ICS-23 membership and non-membership proofs against that root.

When a Cosmos chain verifies Cardano state there is a fundamental asymmetry. Tendermint exposes a consensus-signed `app_hash` each height, so the counterparty can trust the root it verifies proofs against. Cardano does not expose a consensus-signed application state commitment, or anything analogous in block headers, so the IBC HostState UTxO datum (which contains `ibc_state_root`) is an application-level commitment that lives inside the ledger and is not directly attested to by Ouroboros in the same way.

As things currently stand, Cardano IBC state transitions are enforced to be atomic at the script level by requiring any update to committed IBC state to co-spend the HostState UTxO and update `ibc_state_root` in the same transaction, so the commitment root and the underlying state cannot diverge. (This is a tight constraint causing other important considerations discussed below)

Separately, a trustless counterparty must be able to convince itself that the specific HostState UTxO (and the exact datum bytes that contain `ibc_state_root`) is included in a sufficiently finalized view of the Cardano ledger. The concrete mechanism for this attestation is still an open design point. Mithril is relevant here as a potential source of certified ledger snapshots and inclusion proofs, but it does not replace the need for a clear and verifiable story for how a Cosmos chain anchors Cardano state roots over time.

## UTXO Contention

 
The IBC HostState design treats the HostState UTxO (identified by the HostState NFT) as the single source of truth for `ibc_state_root`, every IBC state transition that changes committed state must co-spend that same UTxO to update the root. This effectively serializes all root-changing IBC operations (client, connection, channel, and packet state updates), even if they touch disjoint keys. This allows us to achieve the IBC trust constraints and cryptographic security of the bridge but it also creates contention under load. This is not a correctness problem, but it is a throughput and liveness constraint that differs materially from Cosmos SDK chains where many updates can be committed independently in the same block.

We haven't settled on a production strategy to mitigate this. Options include batching multiple IBC updates into a single HostState-spending transaction, which I think is an uglier solution,  or alternatively sharding committed IBC state into multiple independently-spendable state UTxOs (and adjusting the commitment model and light client verification accordingly) so unrelated flows do not contend on a single global input. This will likely be a complex and challenging solution but I believe is the more "correct" path forward.



## Constrained by Mithril Certificate Frequency

It should be clear that Mithril certificates are **not** produced on a per-block basis. On Cosmos chains IBC proofs are available at essentially every block height because the counterparty can verify ICS-23 proofs against the consensus-signed `app_hash` of that height. In the current Cardano to Cosmos direction, the Cosmos chain instead anchors Cardano IBC state by verifying that a specific HostState-updating transaction is included in a Mithril-certified transaction snapshot, and then extracting the HostState datum bytes (and `ibc_state_root`) from that certified evidence. This means cross-chain progress is bottlenecked by certificate issuance and snapshot publication. If certificates are produced on the order of minutes then a HostState update can be observed by the Gateway immediately but cannot be used as a verifiable proof on the Cosmos chain until it is covered by a certificate. 

This also introduces a height asymmetry: the proof height that the Cosmos chain can safely accept is the Mithril-certified snapshot height and not a Cardano slot number. If we keep Mithril as the attestation layer in production.
