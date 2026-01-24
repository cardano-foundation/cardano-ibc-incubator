# Known Issues, Asymmetries, and Architectural Considerations

## Cardano Key Derivation and Interop With Hermes/Lucid

Cardano wallets do not have a single universally implemented derivation path. The common convention for Shelley-era wallets is CIP-1852, which uses the path `m/1852'/1815'/account'/role/index`, where `role` and `index` are non-hardened. Some Ed25519-BIP32 implementations only support fully hardened derivation, and some toolchains differ in how they interpret or expose these roles. As a result, two pieces of software can legitimately derive different payment addresses from the same BIP-39 mnemonic, which can look like funds disappearing or signatures failing when the real issue is that different components are not using the same derivation scheme.

For local development we currently avoid this class of mismatch by using a shared bech32-encoded private key (`DEPLOYER_SK`) so that Gateway and Hermes are guaranteed to operate with the same signing key material. For production, this should be replaced with a well-defined and consistently implemented key management approach for Cardano.

## Denom Trace Mapping Lives Off-Chain

Cosmos SDK chains store denom trace mappings in a consensus-state KVStore, but Cardano’s UTxO model does not provide an equivalent general-purpose on-chain key-value store. Voucher tokens embed the denom trace hash in their token names, which preserves authenticity, but the reverse lookup from hash to full trace must be maintained off-chain (for example in the Gateway’s database).

The mapping is fully reconstructible from on-chain data because voucher minting transactions contain the full fungible token packet data while simultaneously minting a voucher whose token name is derived from that denom. In practice, however, denom trace queries rely on off-chain indexing infrastructure rather than direct chain state queries, and we should continue to track this asymmetry and decide whether additional on-chain data or standardized rebuild tooling is needed for production readiness.

## Underlying Cryptography

There are two different membership and non-membership problems in IBC, and the asymmetry between Tendermint and Cardano matters in different ways depending on which direction verification is happening.

When Cardano verifies Cosmos state, it follows the standard ICS-07 flow: Cardano stores a trusted consensus root for the Cosmos chain from signed Tendermint headers and verifies ICS-23 membership and non-membership proofs against that root.

When a Cosmos chain verifies Cardano state, there is a fundamental asymmetry. Tendermint exposes a consensus-signed `app_hash` each height, so the counterparty can trust the root it verifies proofs against. Cardano does not expose a consensus-signed application state commitment in block headers, so the IBC HostState UTxO datum (which contains `ibc_state_root`) is an application-level commitment that lives inside the ledger and is not directly attested to by Ouroboros in the same way.

As things currently stand, Cardano IBC state transitions are enforced to be atomic at the script level by requiring any update to committed IBC state to co-spend the HostState UTxO and update `ibc_state_root` in the same transaction, so the commitment root and the underlying state cannot diverge.

Separately, a trustless counterparty must be able to convince itself that the specific HostState UTxO (and the exact datum bytes that contain `ibc_state_root`) is included in a sufficiently finalized view of the Cardano ledger. The concrete mechanism for this attestation is still an open design point. Mithril is relevant here as a potential source of certified ledger snapshots and inclusion proofs, but it does not replace the need for a clear and verifiable story for how a Cosmos chain anchors Cardano state roots over time.
