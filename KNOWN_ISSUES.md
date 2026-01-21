# Known Issues, Asymmetries, and Architectural Considerations

## Cardano Key Derivation and Interop With Hermes/Lucid

Cardano wallets do not have a single universally-implemented “BIP-44” derivation path. The common convention for Shelley-era wallets is CIP-1852, which uses the path `m/1852'/1815'/account'/role/index`, where `role` and `index` are non-hardened. Some generic Ed25519-BIP32 implementations only support fully-hardened derivation, and some toolchains differ in how they interpret or expose these roles. As a result, two pieces of software can legitimately derive different payment addresses from the same BIP-39 mnemonic. This matters in local development because it can look like “funds disappeared” or “signing failed” when the real issue is simply that different components are not using the same derivation scheme.

## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano’s UTXO model lacks an equivalent on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (for example in the Gateway’s database). The mapping is fully reconstructible by scanning voucher minting transactions, yet it relies on off-chain indexing for practical queries. We should continue to track this asymmetry and decide whether additional on-chain data or standardized rebuild tooling is needed for production readiness.

## Underlying Cryptography

There are two different “membership/non-membership” problems in IBC, and our STT architecture plus the Gateway’s in-memory ICS-23 tree only directly addresses one of them.

When Cardano verifies Cosmos state, it is the standard ICS-07 flow: Cardano stores a trusted consensus root for the Cosmos chain (from signed Tendermint headers) and verifies ICS-23 membership and non-membership proofs against that root. Mithril is not relevant in this direction.

When a Cosmos chain verifies Cardano state, there is a fundamental asymmetry. Tendermint exposes a consensus-signed `app_hash` each height, so the counterparty can trust the root it verifies proofs against. Cardano does not expose a consensus-signed application/state commitment in block headers, so the IBC HostState UTxO datum (which contains `ibc_state_root`) is an application-level commitment that lives inside the ledger and is not directly attested to by Ouroboros in the same way.

The STT pattern enforces canonicity and sequencing for the HostState UTxO (single-threading via a unique NFT, monotonic versioning, and operation-specific sequence invariants), but root correctness is not yet enforced for every operation that changes `ibc_state_root`. For operations not yet covered by root correctness enforcement, `ibc_state_root` is still treated as an off-chain computed value and is permitted to change without on-chain recomputation beyond the STT invariants. As things currently stand, this makes it possible for a submitter who is able to perform such updates to commit an arbitrary `ibc_state_root` that satisfies continuity checks, and then provide valid ICS-23 membership proofs against that arbitrary root to a counterparty. In IBC this should not be possible because the commitment root must be uniquely determined by correct state-machine execution under consensus, independent of who relays the transaction.

Making this not possible requires extending root correctness enforcement to every root-changing operation, so validators can validate `new_root` from `old_root` using transaction-provided witnesses (for exactly the allowed key updates) instead of accepting an unconstrained root.
